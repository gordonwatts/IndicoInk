import { randomUUID } from 'node:crypto';
import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';

import type { DirectoryCursor, DirectoryPage } from './syncWorkerCore';

type WorkerCommand =
  | 'initialize'
  | 'beginScan'
  | 'pause'
  | 'resume'
  | 'publish'
  | 'replaceCatalog'
  | 'read'
  | 'enumerate';

type WorkerResponse = {
  requestId: string;
  ok: boolean;
  result?: unknown;
  binary?: Uint8Array;
  error?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class SyncWorkerClient {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private configuration: { rootPath: string; deviceId: string } | null = null;
  private initializedChild: UtilityProcess | null = null;
  private initialization: Promise<unknown> | null = null;
  private paused = false;

  async initialize(rootPath: string, deviceId: string) {
    this.configuration = { rootPath, deviceId };
    this.paused = false;
    const child = this.ensureChild();
    const initialization = this.requestRaw<{ ready: true }>(
      child,
      'initialize',
      {
        rootPath,
        deviceId,
      },
    );
    this.initialization = initialization;
    try {
      const result = await initialization;
      if (this.child === child && this.initialization === initialization) {
        this.initializedChild = child;
      }
      return result;
    } finally {
      if (this.initialization === initialization) {
        this.initialization = null;
      }
    }
  }

  async pause() {
    this.paused = true;
    const child = this.child;
    this.child = null;
    this.initializedChild = null;
    this.initialization = null;
    child?.kill();
    this.rejectAll(new Error('Sync utility process was paused.'));
    return { paused: true as const };
  }

  async resume() {
    this.paused = false;
    return this.request<{ paused: false }>('resume', {});
  }

  beginScan() {
    return this.request<{ ready: true }>('beginScan', {});
  }

  async publishImmutable(relativePath: string, bytes: Uint8Array) {
    return this.request<{ published: true; byteLength: number }>('publish', {
      relativePath,
      bytes: Uint8Array.from(bytes),
    });
  }

  async replaceCatalog(relativePath: string, bytes: Uint8Array) {
    return this.request<{ replaced: boolean; byteLength: number }>(
      'replaceCatalog',
      { relativePath, bytes: Uint8Array.from(bytes) },
    );
  }

  async readFile(relativePath: string, maxBytes?: number) {
    const result = await this.request<{
      bytes: Uint8Array;
      byteLength: number;
    }>('read', {
      relativePath,
      maxBytes,
    });
    if (
      !(result.bytes instanceof Uint8Array) ||
      result.bytes.byteLength !== result.byteLength
    ) {
      throw new Error('Sync utility process returned an invalid byte record.');
    }
    return result.bytes;
  }

  enumerateDirectory(
    cursor: DirectoryCursor,
    limits?: { maxDirectoryEntries?: number; maxElapsedMs?: number },
  ) {
    return this.request<DirectoryPage>('enumerate', { cursor, limits });
  }

  close() {
    const child = this.child;
    this.child = null;
    this.initializedChild = null;
    this.initialization = null;
    this.configuration = null;
    this.paused = false;
    child?.kill();
    this.rejectAll(new Error('Sync utility process was stopped.'));
  }

  private async request<T>(
    command: WorkerCommand,
    payload: Record<string, unknown>,
  ) {
    if (!this.configuration) {
      throw new Error('Sync utility process has not been initialized.');
    }
    if (this.paused) {
      throw new Error('Sync utility process is paused.');
    }
    const child = this.ensureChild();
    if (this.initializedChild !== child) {
      if (!this.initialization) {
        const { rootPath, deviceId } = this.configuration;
        this.initialization = this.requestRaw(child, 'initialize', {
          rootPath,
          deviceId,
        });
      }
      const initialization = this.initialization;
      try {
        await initialization;
        if (this.child === child && this.initialization === initialization) {
          this.initializedChild = child;
        }
      } finally {
        if (this.initialization === initialization) {
          this.initialization = null;
        }
      }
    }
    if (this.child !== child) {
      throw new Error('Sync utility process restarted during initialization.');
    }
    return this.requestRaw<T>(child, command, payload);
  }

  private requestRaw<T>(
    child: UtilityProcess,
    command: WorkerCommand,
    payload: Record<string, unknown>,
  ) {
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.child === child) {
          this.child = null;
          this.initializedChild = null;
          this.initialization = null;
          child.kill();
        }
        this.rejectAll(new Error('Sync utility process exceeded 10 seconds.'));
      }, 10_000);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      child.postMessage({ requestId, command, payload });
    });
  }

  private ensureChild() {
    if (this.child) {
      return this.child;
    }
    const child = utilityProcess.fork(join(__dirname, 'syncWorker.js'), [], {
      serviceName: 'IndicoInk Folder Sync',
      stdio: 'pipe',
    });
    this.child = child;
    child.on('message', (message: WorkerResponse) => {
      if (
        this.child !== child ||
        !message ||
        typeof message.requestId !== 'string'
      ) {
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(message.requestId);
      if (message.ok) {
        pending.resolve(
          message.binary && message.result && typeof message.result === 'object'
            ? { ...message.result, bytes: message.binary }
            : message.result,
        );
      } else {
        pending.reject(
          new Error(message.error ?? 'Sync utility process failed.'),
        );
      }
    });
    child.on('exit', (code) => {
      if (this.child === child) {
        this.child = null;
        this.initializedChild = null;
        this.initialization = null;
        this.rejectAll(
          new Error(
            `Sync utility process exited${code === 0 ? '' : ` (${code})`}.`,
          ),
        );
      }
    });
    child.on('error', (_type, location) => {
      if (this.child === child) {
        this.child = null;
        this.initializedChild = null;
        this.initialization = null;
        this.rejectAll(
          new Error(
            `Sync utility process failed${location ? ` at ${location}` : ''}.`,
          ),
        );
      }
    });
    return child;
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
