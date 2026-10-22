import {
  canonicalJson,
  isUuid,
  operationPath,
  parseStrictSyncJson,
  validateCatalog,
  validateOperation,
  validateOperationLocation,
  isShareableSourceUrl,
} from './syncProtocol';
import type { SyncStatus } from './shared/sync';
import type { DirectoryCursor, DirectoryPage } from './syncWorkerCore';
import type { PersistenceStore } from './persistenceStore';

export type SyncTransport = {
  initialize(rootPath: string, deviceId: string): Promise<unknown>;
  beginScan(): Promise<unknown>;
  publishImmutable(relativePath: string, bytes: Uint8Array): Promise<unknown>;
  replaceCatalog(relativePath: string, bytes: Uint8Array): Promise<unknown>;
  readFile(relativePath: string, maxBytes?: number): Promise<Uint8Array>;
  enumerateDirectory(
    cursor: DirectoryCursor,
    limits?: { maxDirectoryEntries?: number; maxElapsedMs?: number },
  ): Promise<DirectoryPage>;
  pause(): Promise<unknown>;
  resume(): Promise<unknown>;
  close(): void;
};

type CoordinatorTimers = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

const DEFAULT_TIMERS: CoordinatorTimers = {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};

const MAX_SCAN_ENTRIES = 1000;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_SCAN_MS = 10_000;
const SCAN_INTERVAL_MS = 15 * 60 * 1000;
const PUBLICATION_DEBOUNCE_MS = 750;
const RETRY_DELAYS_MS = [2000, 5000, 15000, 60000, 300000];

type ScanDirectory = {
  relativeDirectory: string;
  lastName: string | null;
};

const workspaceRecord = (workspaceId: string) =>
  new TextEncoder().encode(
    canonicalJson({
      format: 'indicoink-folder-sync',
      version: 1,
      workspaceId,
    }),
  );

const parseWorkspaceId = (bytes: Uint8Array) => {
  const value = parseStrictSyncJson(bytes, {
    maxBytes: 4096,
    requireCanonical: true,
  });
  if (
    !value ||
    typeof value !== 'object' ||
    !('format' in value) ||
    value.format !== 'indicoink-folder-sync' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('workspaceId' in value) ||
    !isUuid(value.workspaceId) ||
    Object.keys(value).length !== 3
  ) {
    throw new Error('Sync folder workspace record is invalid or unsupported.');
  }
  return value.workspaceId;
};

/**
 * Main-process sync scheduling and protocol coordination. Every shared-folder
 * operation is delegated to the utility process transport.
 */
export class SyncCoordinator {
  private status: SyncStatus = {
    state: 'not-configured',
    message: 'Set up sync across your devices.',
    pendingChanges: 0,
    folderPath: null,
    lastCheckedAt: null,
    lastPublishedAt: null,
    peerReceivedAt: null,
    cloudDeliveryConfirmed: false,
  };
  private started = false;
  private running: Promise<void> | null = null;
  private runAgainRequested = false;
  private activeDeckId: string | null = null;
  private releasedDeckIds = new Set<string>();
  private publicationTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private followupTimer: ReturnType<typeof setTimeout> | null = null;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private retryAttempt = 0;
  private scanQueue: ScanDirectory[] = [];
  private lifecycleEpoch = 0;

  constructor(
    private readonly store: PersistenceStore,
    private readonly transport: SyncTransport,
    private readonly onStatus: (status: SyncStatus) => void,
    private readonly timers: CoordinatorTimers = DEFAULT_TIMERS,
    private readonly monotonicNow = () => performance.now(),
    private readonly wallClockNow = () => Date.now(),
  ) {}

  getStatus() {
    return { ...this.status };
  }

  setActiveDeck(deckId: string | null) {
    const previousDeckId = this.activeDeckId;
    this.activeDeckId = deckId;
    if (previousDeckId && previousDeckId !== deckId && this.started) {
      this.releasedDeckIds.add(previousDeckId);
      if (this.running) this.runAgainRequested = true;
      else void this.runAttempt();
    }
  }

  async start() {
    if (this.started) return this.getStatus();
    this.started = true;
    const profile = await this.store.getSyncProfile();
    if (!profile.workspaceId || !profile.folderPath) {
      this.publishStatus({
        state: 'not-configured',
        message: 'Set up sync across your devices.',
        pendingChanges: await this.store.countPendingSyncOutbox(),
      });
      return this.getStatus();
    }
    if (!profile.enabled) {
      this.publishStatus({
        state: 'paused',
        message: 'Sync is paused. Changes are saved on this device.',
        pendingChanges: await this.store.countPendingSyncOutbox(),
      });
      return this.getStatus();
    }

    try {
      this.scanQueue = await this.store.getSyncScanQueue();
      this.scanTimer = this.timers.setInterval(() => {
        void this.runAttempt();
      }, SCAN_INTERVAL_MS);
      await this.runAttempt();
    } catch (error) {
      this.handleFailure(error);
    }
    return this.getStatus();
  }

  notifyLocalChanges() {
    if (!this.started || this.status.state === 'not-configured') return;
    if (this.status.state === 'paused') {
      this.publishStatus({
        state: 'paused',
        message: 'Sync is paused. New changes are saved on this device.',
        pendingChanges: this.status.pendingChanges + 1,
      });
      return;
    }
    if (this.status.state === 'needs-attention') {
      this.publishStatus({
        state: 'needs-attention',
        message: 'Sync needs attention. New changes are saved on this device.',
        pendingChanges: this.status.pendingChanges + 1,
      });
      return;
    }
    this.publishStatus({
      state: 'waiting',
      message: 'Changes are saved locally; waiting for publication.',
      pendingChanges: this.status.pendingChanges,
    });
    if (this.publicationTimer) this.timers.clearTimeout(this.publicationTimer);
    this.publicationTimer = this.timers.setTimeout(() => {
      this.publicationTimer = null;
      void this.runAttempt();
    }, PUBLICATION_DEBOUNCE_MS);
  }

  async retryNow() {
    if (!this.started) return this.start();
    if (this.retryTimer) this.timers.clearTimeout(this.retryTimer);
    if (this.followupTimer) this.timers.clearTimeout(this.followupTimer);
    this.retryTimer = null;
    this.followupTimer = null;
    this.retryAttempt = 0;
    await this.runAttempt();
    return this.getStatus();
  }

  async pause() {
    this.lifecycleEpoch += 1;
    this.started = false;
    this.runAgainRequested = false;
    this.releasedDeckIds.clear();
    if (this.publicationTimer) this.timers.clearTimeout(this.publicationTimer);
    if (this.retryTimer) this.timers.clearTimeout(this.retryTimer);
    if (this.followupTimer) this.timers.clearTimeout(this.followupTimer);
    if (this.scanTimer) this.timers.clearInterval(this.scanTimer);
    this.publicationTimer = null;
    this.retryTimer = null;
    this.followupTimer = null;
    this.scanTimer = null;
    await this.transport.pause();
    await this.running?.catch(() => undefined);
    this.publishStatus({
      state: 'paused',
      message: 'Sync is paused. Changes are saved on this device.',
      pendingChanges: await this.store.countPendingSyncOutbox(),
    });
  }

  async resume() {
    const profile = await this.store.getSyncProfile();
    this.status.folderPath = profile.folderPath;
    if (!profile.workspaceId || !profile.folderPath) return this.start();
    if (this.scanTimer) this.timers.clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.lifecycleEpoch += 1;
    await this.transport.initialize(profile.folderPath, profile.deviceId);
    await this.ensureWorkspace(profile.workspaceId);
    await this.transport.resume();
    this.started = true;
    this.scanQueue = await this.store.getSyncScanQueue();
    this.scanTimer = this.timers.setInterval(() => {
      void this.runAttempt();
    }, SCAN_INTERVAL_MS);
    await this.runAttempt();
    return this.getStatus();
  }

  close() {
    this.lifecycleEpoch += 1;
    this.runAgainRequested = false;
    this.releasedDeckIds.clear();
    if (this.publicationTimer) this.timers.clearTimeout(this.publicationTimer);
    if (this.retryTimer) this.timers.clearTimeout(this.retryTimer);
    if (this.followupTimer) this.timers.clearTimeout(this.followupTimer);
    if (this.scanTimer) this.timers.clearInterval(this.scanTimer);
    this.publicationTimer = null;
    this.retryTimer = null;
    this.followupTimer = null;
    this.scanTimer = null;
    this.started = false;
    this.transport.close();
  }

  async stop() {
    this.lifecycleEpoch += 1;
    this.runAgainRequested = false;
    this.releasedDeckIds.clear();
    if (this.publicationTimer) this.timers.clearTimeout(this.publicationTimer);
    if (this.retryTimer) this.timers.clearTimeout(this.retryTimer);
    if (this.followupTimer) this.timers.clearTimeout(this.followupTimer);
    if (this.scanTimer) this.timers.clearInterval(this.scanTimer);
    this.publicationTimer = null;
    this.retryTimer = null;
    this.followupTimer = null;
    this.scanTimer = null;
    this.started = false;
    await this.transport.pause().catch(() => undefined);
    await this.running?.catch(() => undefined);
    this.transport.close();
  }

  async disconnect(pendingChanges: number) {
    await this.stop();
    this.publishStatus({
      state: 'not-configured',
      message: 'Sync is disconnected. Local data remains on this device.',
      pendingChanges,
      folderPath: null,
    });
    return this.getStatus();
  }

  private async ensureWorkspace(workspaceId: string) {
    let current: Uint8Array;
    try {
      current = await this.transport.readFile('workspace.json', 4096);
    } catch (error) {
      if (!/ENOENT|not found/i.test(String(error))) throw error;
      try {
        await this.transport.publishImmutable(
          'workspace.json',
          workspaceRecord(workspaceId),
        );
      } catch (publishError) {
        if (!/already contains|EEXIST/i.test(String(publishError))) {
          throw publishError;
        }
      }
      current = await this.transport.readFile('workspace.json', 4096);
    }
    if (parseWorkspaceId(current) !== workspaceId) {
      throw new Error(
        'The selected folder belongs to a different sync library.',
      );
    }
  }

  private async runAttempt() {
    if (!this.started) return;
    if (this.running) {
      this.runAgainRequested = true;
      return this.running;
    }
    this.running = this.runAttemptInner().finally(() => {
      this.running = null;
      if (this.runAgainRequested && this.started) {
        this.runAgainRequested = false;
        const epoch = this.lifecycleEpoch;
        this.followupTimer = this.timers.setTimeout(() => {
          this.followupTimer = null;
          if (this.started && epoch === this.lifecycleEpoch) {
            void this.runAttempt();
          }
        }, 0);
      }
    });
    return this.running;
  }

  private async runAttemptInner() {
    const epoch = this.lifecycleEpoch;
    try {
      const profile = await this.store.getSyncProfile();
      if (!profile.enabled || !profile.workspaceId || !profile.folderPath)
        return;
      // The viewer has released these decks, so locally queued imports can
      // be applied even when the sync folder cannot be reached for this run.
      for (const deckId of this.releasedDeckIds) {
        if (epoch !== this.lifecycleEpoch) return;
        if (deckId === this.activeDeckId) continue;
        const applied = await this.store.applyDownloadedAnnotationOperations(
          `deck:${deckId}`,
        );
        if (epoch !== this.lifecycleEpoch) return;
        if (applied) {
          this.publishStatus({
            state: this.status.state,
            message: this.status.message,
            peerReceivedAt: this.wallClockNow(),
          });
        }
        this.releasedDeckIds.delete(deckId);
      }
      await this.transport.initialize(profile.folderPath, profile.deviceId);
      await this.ensureWorkspace(profile.workspaceId);
      if (epoch !== this.lifecycleEpoch) return;
      const catalog = await this.store.createSyncCatalog();
      if (catalog) {
        await this.transport.replaceCatalog(
          `devices/${profile.deviceId}/catalog.json`,
          new TextEncoder().encode(canonicalJson(catalog)),
        );
      }
      this.publishStatus({
        state: 'checking',
        message: 'Checking the sync folder…',
        pendingChanges: this.status.pendingChanges,
      });
      await this.scanBounded(profile.workspaceId, epoch);
      if (epoch !== this.lifecycleEpoch) return;
      const downloadedBeforeApply =
        await this.store.listDownloadedSyncOperations();
      const downloadedStreams = new Set(
        downloadedBeforeApply.map((operation) => operation.streamId),
      );
      for (const streamId of downloadedStreams) {
        if (epoch !== this.lifecycleEpoch) return;
        let applied = false;
        if (streamId.startsWith('metadata:')) {
          applied =
            await this.store.applyDownloadedMetadataOperations(streamId);
        } else if (
          streamId.startsWith('deck:') &&
          streamId.slice('deck:'.length) !== this.activeDeckId
        ) {
          applied =
            await this.store.applyDownloadedAnnotationOperations(streamId);
        }
        if (epoch !== this.lifecycleEpoch) return;
        if (applied) {
          this.publishStatus({
            state: this.status.state,
            message: this.status.message,
            peerReceivedAt: this.wallClockNow(),
          });
        }
      }
      const pending = await this.store.listPendingSyncOutbox(32);
      if (pending.length) {
        this.publishStatus({
          state: 'publishing',
          message: `Publishing ${pending.length} local changes to the sync folder…`,
          pendingChanges: pending.length,
        });
        for (const entry of pending) {
          if (epoch !== this.lifecycleEpoch) return;
          let operation;
          try {
            operation = validateOperation(entry.operation);
            if (
              operation.workspaceId !== profile.workspaceId ||
              operation.deviceId !== profile.deviceId
            ) {
              throw new Error(
                'the saved change belongs to another sync identity',
              );
            }
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : 'invalid operation';
            throw new Error(
              `A saved local change cannot be published safely: ${reason}`,
            );
          }
          let conferenceId: string;
          if (operation.streamId.startsWith('metadata:')) {
            conferenceId = operation.streamId.slice('metadata:'.length);
          } else if (entry.conferenceId) {
            conferenceId = entry.conferenceId;
            const deckId = operation.streamId.slice('deck:'.length);
            const currentDeck = await this.store.getDeck(deckId);
            if (currentDeck && currentDeck.conferenceId !== conferenceId) {
              throw new Error(
                'A pending sync change belongs to a different conference than its deck.',
              );
            }
          } else {
            const deckId = operation.streamId.slice('deck:'.length);
            const deck = await this.store.getDeck(deckId);
            if (!deck)
              throw new Error('A pending sync deck is no longer available.');
            conferenceId = deck.conferenceId;
          }
          const conference = await this.store.getConference(conferenceId);
          if (!conference || !isShareableSourceUrl(conference.sourceUrl)) {
            throw new Error(
              'A pending sync change belongs to an unavailable or local-only conference.',
            );
          }
          const relativePath = operationPath(operation, conferenceId);
          validateOperationLocation(relativePath, operation);
          const bytes = new TextEncoder().encode(canonicalJson(operation));
          await this.transport.publishImmutable(relativePath, bytes);
          await this.store.markSyncOperationPublished(
            operation.operationId,
            this.wallClockNow(),
          );
        }
      }
      const remaining = (await this.store.listPendingSyncOutbox(32)).length;
      const downloaded = await this.store.listDownloadedSyncOperations();
      if (epoch !== this.lifecycleEpoch) return;
      const downloadsWaiting = downloaded.length > 0;
      this.retryAttempt = 0;
      this.publishStatus({
        state: remaining ? 'waiting' : downloadsWaiting ? 'waiting' : 'idle',
        message: remaining
          ? 'Changes are saved locally; more changes are waiting for publication.'
          : downloadsWaiting
            ? `${downloaded.length} remote changes are waiting for missing metadata parts, prerequisites, or an open deck.`
            : 'No pending local changes. Cloud delivery is unconfirmed.',
        pendingChanges: remaining,
        lastCheckedAt: this.wallClockNow(),
        ...(pending.length ? { lastPublishedAt: this.wallClockNow() } : {}),
      });
      if (remaining > 0) this.runAgainRequested = true;
    } catch (error) {
      if (epoch === this.lifecycleEpoch) {
        this.runAgainRequested = false;
        this.handleFailure(error);
      }
    }
  }

  private async scanBounded(workspaceId: string, epoch: number) {
    if (!this.scanQueue.length) {
      await this.transport.beginScan();
      this.scanQueue = [
        { relativeDirectory: 'devices', lastName: null },
        { relativeDirectory: 'conferences', lastName: null },
      ];
    }
    const startedAt = this.monotonicNow();
    let entriesExamined = 0;
    let bytesRead = 0;
    while (
      this.scanQueue.length &&
      entriesExamined < MAX_SCAN_ENTRIES &&
      bytesRead < MAX_SCAN_BYTES &&
      this.monotonicNow() - startedAt < MAX_SCAN_MS
    ) {
      const cursor = this.scanQueue.shift()!;
      const remainingEntries = MAX_SCAN_ENTRIES - entriesExamined;
      const remainingMs = Math.max(
        1,
        MAX_SCAN_MS - (this.monotonicNow() - startedAt),
      );
      let page: DirectoryPage;
      try {
        page = await this.transport.enumerateDirectory(cursor, {
          maxDirectoryEntries: remainingEntries,
          maxElapsedMs: Math.min(remainingMs, MAX_SCAN_MS),
        });
      } catch (error) {
        if (/ENOENT|not found/i.test(String(error))) continue;
        throw error;
      }
      if (
        page.partial &&
        page.entries.length === 0 &&
        page.examined === 0 &&
        (!page.nextCursor ||
          (page.nextCursor.relativeDirectory === cursor.relativeDirectory &&
            page.nextCursor.lastName === cursor.lastName))
      ) {
        throw new Error(
          'The sync folder is taking too long to enumerate. Retry when it is available.',
        );
      }
      entriesExamined += page.examined;
      let lastProcessedName = cursor.lastName;
      let pageComplete = true;
      for (const entry of page.entries) {
        if (
          epoch !== this.lifecycleEpoch ||
          entriesExamined > MAX_SCAN_ENTRIES ||
          this.monotonicNow() - startedAt >= MAX_SCAN_MS
        ) {
          pageComplete = false;
          break;
        }
        if (entry.kind === 'directory') {
          this.scanQueue.push({
            relativeDirectory: `${cursor.relativeDirectory}/${entry.name}`,
            lastName: null,
          });
          lastProcessedName = entry.name;
          continue;
        }
        const relativePath = `${cursor.relativeDirectory}/${entry.name}`;
        const catalogMatch = relativePath.match(
          /^devices\/([0-9a-f-]{36})\/catalog\.json$/,
        );
        if (catalogMatch) {
          const remainingBytes = MAX_SCAN_BYTES - bytesRead;
          if (remainingBytes < 2 * 1024 * 1024) {
            pageComplete = false;
            break;
          }
          const bytes = await this.transport.readFile(
            relativePath,
            Math.min(2 * 1024 * 1024, remainingBytes),
          );
          bytesRead += bytes.byteLength;
          const catalog = validateCatalog(parseStrictSyncJson(bytes));
          if (catalog.deviceId !== catalogMatch[1]) {
            throw new Error('Sync catalog path does not match its device ID.');
          }
          await this.store.applyRemoteSyncCatalog(catalog);
          lastProcessedName = entry.name;
          continue;
        }
        if (!relativePath.includes('/ops/')) {
          lastProcessedName = entry.name;
          continue;
        }
        const remainingBytes = MAX_SCAN_BYTES - bytesRead;
        if (remainingBytes < 2 * 1024 * 1024) {
          pageComplete = false;
          break;
        }
        const bytes = await this.transport.readFile(
          relativePath,
          Math.min(2 * 1024 * 1024, remainingBytes),
        );
        bytesRead += bytes.byteLength;
        const parsed = parseStrictSyncJson(bytes);
        const operation = validateOperation(parsed);
        if (operation.workspaceId !== workspaceId) {
          throw new Error('A sync operation belongs to a different library.');
        }
        validateOperationLocation(relativePath, operation);
        await this.store.recordDownloadedSyncOperation(operation);
        lastProcessedName = entry.name;
      }
      if (!pageComplete) {
        this.scanQueue.unshift({
          relativeDirectory: cursor.relativeDirectory,
          lastName: lastProcessedName,
        });
      } else if (page.nextCursor) {
        this.scanQueue.unshift(page.nextCursor);
      }
    }
    await this.store.setSyncScanQueue(this.scanQueue);
    if (this.scanQueue.length > 0 && epoch === this.lifecycleEpoch) {
      this.runAgainRequested = true;
    }
  }

  private handleFailure(error: unknown) {
    const message = error instanceof Error ? error.message : 'Sync failed.';
    const unavailable =
      /\b(?:ENOENT|EACCES|EPERM|EBUSY|ENOTDIR|EIO|ENOSPC)\b/i.test(message) ||
      /(?:folder|utility process).*(?:unavailable|exited|exceeded)/i.test(
        message,
      );
    this.publishStatus({
      state: 'needs-attention',
      message: `${unavailable ? 'Sync folder unavailable' : 'Sync needs attention'}: ${message}`,
      pendingChanges: this.status.pendingChanges,
    });
    if (this.retryTimer) this.timers.clearTimeout(this.retryTimer);
    const delay =
      RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)]!;
    this.retryAttempt += 1;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      void this.runAttempt();
    }, delay);
  }

  private publishStatus(
    update: Partial<SyncStatus> & Pick<SyncStatus, 'state' | 'message'>,
  ) {
    this.status = {
      ...this.status,
      ...update,
      cloudDeliveryConfirmed: false,
    };
    this.onStatus(this.getStatus());
  }
}
