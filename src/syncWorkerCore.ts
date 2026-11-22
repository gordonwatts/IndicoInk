import { randomUUID } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  unlink,
  link,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { canonicalJson, isUuid, parseStrictSyncJson } from './syncProtocol';

export type SyncWorkerLimits = {
  maxFileBytes: number;
  maxDirectoryEntries: number;
  maxReadBytes: number;
  maxElapsedMs: number;
};

export type DirectoryCursor = {
  relativeDirectory: string;
  lastName: string | null;
};

export type DirectoryPage = {
  entries: Array<{ name: string; kind: 'file' | 'directory' }>;
  nextCursor: DirectoryCursor | null;
  examined: number;
  partial: boolean;
};

const DEFAULT_LIMITS: SyncWorkerLimits = {
  maxFileBytes: 2 * 1024 * 1024,
  maxDirectoryEntries: 1000,
  maxReadBytes: 8 * 1024 * 1024,
  maxElapsedMs: 10_000,
};

const assertSafeRelativePath = (path: string) => {
  if (
    path.length === 0 ||
    path.length > 2048 ||
    path.includes('\\') ||
    path.includes('\0') ||
    isAbsolute(path) ||
    path
      .split('/')
      .some(
        (segment) =>
          segment === '' ||
          segment === '.' ||
          segment === '..' ||
          segment.length > 240 ||
          /[<>:"|?*]/.test(segment) ||
          Array.from(segment).some(
            (character) => character.charCodeAt(0) < 32,
          ) ||
          /[. ]$/.test(segment) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
      )
  ) {
    throw new Error('Sync worker rejected an unsafe relative path.');
  }
};

const isReparsePoint = (entry: Dirent | Awaited<ReturnType<typeof lstat>>) =>
  entry.isSymbolicLink();

export class SyncWorkerCore {
  private rootPath: string | null = null;
  private deviceId: string | null = null;
  private paused = false;

  async initialize(rootPath: string, deviceId: string) {
    if (!isAbsolute(rootPath) || !isUuid(deviceId)) {
      throw new Error('Sync folder path and device identity are invalid.');
    }
    const rootStat = await lstat(rootPath);
    if (!rootStat.isDirectory() || isReparsePoint(rootStat)) {
      throw new Error('Sync folder must be a normal directory, not a link.');
    }
    this.rootPath = await realpath(rootPath);
    this.deviceId = deviceId;
    this.paused = false;
    return { ready: true as const };
  }

  pause() {
    this.paused = true;
    return { paused: true as const };
  }

  resume() {
    this.paused = false;
    return { paused: false as const };
  }

  async publishImmutable(relativePath: string, bytes: Uint8Array) {
    this.assertActive();
    assertSafeRelativePath(relativePath);
    if (bytes.byteLength > DEFAULT_LIMITS.maxFileBytes) {
      throw new Error('Sync record exceeds the file size limit.');
    }
    const finalPath = await this.ensureParent(relativePath);
    const temporaryPath = join(dirname(finalPath), `.tmp-${randomUUID()}`);
    let handle: FileHandle | null = null;
    try {
      handle = await open(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      try {
        await link(temporaryPath, finalPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          const existing = await this.readFile(
            relativePath,
            DEFAULT_LIMITS.maxFileBytes,
          );
          if (!existing.equals(Buffer.from(bytes))) {
            throw new Error(
              'Sync publication path already contains different bytes.',
            );
          }
        } else {
          throw new Error(
            `Sync folder does not support atomic no-clobber publication (${code ?? 'unknown error'}).`,
          );
        }
      }
      const published = await this.readFile(
        relativePath,
        DEFAULT_LIMITS.maxFileBytes,
      );
      if (!published.equals(Buffer.from(bytes))) {
        throw new Error('Sync publication changed during verification.');
      }
      await unlink(temporaryPath);
      return { published: true as const, byteLength: bytes.byteLength };
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async replaceCatalog(relativePath: string, bytes: Uint8Array) {
    this.assertActive();
    assertSafeRelativePath(relativePath);
    if (
      !this.deviceId ||
      relativePath !== `devices/${this.deviceId}/catalog.json` ||
      basename(relativePath) !== 'catalog.json'
    ) {
      throw new Error('Only a device catalog can be replaced.');
    }
    if (bytes.byteLength > 2 * 1024 * 1024) {
      throw new Error('Sync catalog exceeds the file size limit.');
    }
    const next = parseStrictSyncJson(bytes);
    if (
      !next ||
      typeof next !== 'object' ||
      !('format' in next) ||
      next.format !== 'indicoink-catalog' ||
      !('workspaceId' in next) ||
      !isUuid(next.workspaceId) ||
      !('deviceId' in next) ||
      next.deviceId !== this.deviceId ||
      !('generation' in next) ||
      !Number.isSafeInteger(next.generation) ||
      (next.generation as number) < 1
    ) {
      throw new Error('Sync catalog identity or generation is invalid.');
    }
    const finalPath = await this.ensureParent(relativePath);
    let existing: Buffer | null = null;
    try {
      existing = await this.readFile(relativePath, 2 * 1024 * 1024);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    if (existing) {
      const previous = parseStrictSyncJson(existing);
      if (
        !previous ||
        typeof previous !== 'object' ||
        !('workspaceId' in previous) ||
        previous.workspaceId !== next.workspaceId ||
        !('deviceId' in previous) ||
        previous.deviceId !== this.deviceId ||
        !('generation' in previous) ||
        !Number.isSafeInteger(previous.generation) ||
        (previous.generation as number) >= (next.generation as number)
      ) {
        throw new Error(
          'Sync catalog must advance the same device and workspace.',
        );
      }
    }
    const temporaryPath = join(dirname(finalPath), `.tmp-${randomUUID()}`);
    let handle: FileHandle | null = null;
    try {
      handle = await open(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporaryPath, finalPath);
      return { replaced: true as const, byteLength: bytes.byteLength };
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async readFile(relativePath: string, maxBytes = DEFAULT_LIMITS.maxFileBytes) {
    this.assertActive();
    assertSafeRelativePath(relativePath);
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > DEFAULT_LIMITS.maxReadBytes
    ) {
      throw new Error('Sync read byte limit is invalid.');
    }
    const path = await this.resolvePath(relativePath, false);
    const stat = await lstat(path);
    if (!stat.isFile() || isReparsePoint(stat)) {
      throw new Error('Sync records must be regular files.');
    }
    if (stat.size > maxBytes) {
      throw new Error('Sync file exceeds its read byte limit.');
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const openedStat = await handle.stat();
      const beforeReadPath = await realpath(path);
      const beforeReadRelative = relative(this.rootPath!, beforeReadPath);
      if (
        !openedStat.isFile() ||
        beforeReadRelative === '..' ||
        beforeReadRelative.startsWith(`..${sep}`) ||
        isAbsolute(beforeReadRelative) ||
        (await lstat(path)).isSymbolicLink()
      ) {
        throw new Error('Sync file resolves outside the configured folder.');
      }
      const bytes = Buffer.alloc(openedStat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          offset,
          Math.min(64 * 1024, bytes.length - offset),
          offset,
        );
        if (bytesRead === 0) {
          throw new Error('Sync file changed while it was being read.');
        }
        offset += bytesRead;
      }
      const finalStat = await handle.stat();
      const afterReadPath = await realpath(path);
      const afterReadRelative = relative(this.rootPath!, afterReadPath);
      if (
        finalStat.dev !== openedStat.dev ||
        finalStat.ino !== openedStat.ino ||
        finalStat.size !== openedStat.size ||
        afterReadRelative === '..' ||
        afterReadRelative.startsWith(`..${sep}`) ||
        isAbsolute(afterReadRelative) ||
        (await lstat(path)).isSymbolicLink()
      ) {
        throw new Error('Sync file changed while it was being read.');
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }

  async enumerateDirectory(
    cursor: DirectoryCursor,
    limits: Partial<SyncWorkerLimits> = {},
  ): Promise<DirectoryPage> {
    this.assertActive();
    assertSafeRelativePath(cursor.relativeDirectory);
    const activeLimits = { ...DEFAULT_LIMITS, ...limits };
    if (
      !cursor ||
      (cursor.lastName !== null &&
        (typeof cursor.lastName !== 'string' ||
          cursor.lastName.length === 0 ||
          cursor.lastName.includes('/') ||
          cursor.lastName.includes('\\'))) ||
      !Number.isSafeInteger(activeLimits.maxDirectoryEntries) ||
      activeLimits.maxDirectoryEntries < 1 ||
      activeLimits.maxDirectoryEntries > DEFAULT_LIMITS.maxDirectoryEntries ||
      !Number.isSafeInteger(activeLimits.maxElapsedMs) ||
      activeLimits.maxElapsedMs < 1 ||
      activeLimits.maxElapsedMs > DEFAULT_LIMITS.maxElapsedMs
    ) {
      throw new Error('Sync directory entry limit is invalid.');
    }
    const startedAt = performance.now();
    const directoryPath = await this.resolvePath(
      cursor.relativeDirectory,
      false,
    );
    const directoryStat = await lstat(directoryPath);
    if (!directoryStat.isDirectory() || isReparsePoint(directoryStat)) {
      throw new Error('Sync enumeration target must be a normal directory.');
    }
    const directory = await opendir(directoryPath);
    const collected: Array<{ name: string; kind: 'file' | 'directory' }> = [];
    let partial = false;
    for await (const entry of directory) {
      if (performance.now() - startedAt > activeLimits.maxElapsedMs) {
        partial = true;
        break;
      }
      if (isReparsePoint(entry)) {
        throw new Error(`Sync folder contains a link: ${entry.name}`);
      }
      if (!entry.isDirectory() && !entry.isFile()) {
        throw new Error(
          `Sync folder contains an unsupported entry: ${entry.name}`,
        );
      }
      collected.push({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file',
      });
      if (collected.length > DEFAULT_LIMITS.maxDirectoryEntries) {
        throw new Error('Sync directory exceeds its bounded entry limit.');
      }
    }
    if (partial) {
      return {
        entries: [],
        nextCursor: cursor,
        examined: collected.length,
        partial: true,
      };
    }
    collected.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    const remaining = cursor.lastName
      ? collected.filter(({ name }) => name > cursor.lastName!)
      : collected;
    const pageEntries = remaining.slice(0, activeLimits.maxDirectoryEntries);
    const hasMore = remaining.length > pageEntries.length || partial;
    const lastName = pageEntries.at(-1)?.name ?? cursor.lastName;
    return {
      entries: pageEntries,
      examined: collected.length,
      partial: hasMore,
      nextCursor: hasMore ? { ...cursor, lastName: lastName ?? null } : null,
    };
  }

  private assertActive() {
    if (!this.rootPath) {
      throw new Error('Sync worker has not been initialized.');
    }
    if (this.paused) {
      throw new Error('Sync worker is paused.');
    }
  }

  private async resolvePath(relativePath: string, allowMissing: boolean) {
    const root = this.rootPath;
    if (!root) {
      throw new Error('Sync worker has not been initialized.');
    }
    assertSafeRelativePath(relativePath);
    const candidate = resolve(root, ...relativePath.split('/'));
    const relativeToRoot = relative(root, candidate);
    if (
      relativeToRoot === '..' ||
      relativeToRoot.startsWith(`..${sep}`) ||
      isAbsolute(relativeToRoot)
    ) {
      throw new Error('Sync path escapes the configured folder.');
    }
    const parts = relativePath.split('/');
    let current = root;
    for (let index = 0; index < parts.length; index += 1) {
      current = join(current, parts[index]!);
      try {
        const stat = await lstat(current);
        if (isReparsePoint(stat)) {
          throw new Error(
            'Sync paths cannot traverse links or reparse points.',
          );
        }
        if (index < parts.length - 1 && !stat.isDirectory()) {
          throw new Error('Sync path parent is not a directory.');
        }
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code === 'ENOENT' &&
          allowMissing
        ) {
          continue;
        }
        throw error;
      }
    }
    const resolved = await realpath(dirname(candidate)).catch(
      (error: NodeJS.ErrnoException) => {
        if (allowMissing && error.code === 'ENOENT') {
          return root;
        }
        throw error;
      },
    );
    const parentRelative = relative(root, resolved);
    if (
      parentRelative === '..' ||
      parentRelative.startsWith(`..${sep}`) ||
      isAbsolute(parentRelative)
    ) {
      throw new Error('Sync path resolves outside the configured folder.');
    }
    return candidate;
  }

  private async ensureParent(relativePath: string) {
    const root = this.rootPath;
    if (!root) {
      throw new Error('Sync worker has not been initialized.');
    }
    const parentPath = dirname(resolve(root, ...relativePath.split('/')));
    const parentRelative = relative(root, parentPath)
      .split(sep)
      .filter(Boolean);
    let current = root;
    for (const part of parentRelative) {
      current = join(current, part);
      try {
        await mkdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      }
      const stat = await lstat(current);
      if (!stat.isDirectory() || isReparsePoint(stat)) {
        throw new Error('Sync path contains a non-directory or linked parent.');
      }
    }
    const finalPath = await this.resolvePath(relativePath, true);
    const finalStat = await lstat(finalPath).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      },
    );
    if (finalStat && (!finalStat.isFile() || isReparsePoint(finalStat))) {
      throw new Error('Sync publication target is not a regular file.');
    }
    return finalPath;
  }
}

export const syncWorkerDefaultLimits = DEFAULT_LIMITS;

export const serializeWorkerResult = (value: unknown) =>
  JSON.parse(canonicalJson(value)) as unknown;
