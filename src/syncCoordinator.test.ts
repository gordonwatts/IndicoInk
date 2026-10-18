import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createOperation, canonicalJson } from './syncProtocol';
import { createConferenceId } from './persistenceModels';
import { SyncCoordinator } from './syncCoordinator';
import type {
  PersistenceStore,
  SyncOutboxEntry,
} from './persistenceStoreNodeSqlite';
import type { SyncTransport } from './syncCoordinator';

const workspaceId = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
const deviceId = '72fc257a-40d2-4b19-ae71-b2a02f4fe5e6';
const annotation = {
  kind: 'text' as const,
  id: 'note-1',
  conferenceId: 'conference_1',
  talkId: 'talk_1',
  deckId: 'deck_1',
  slideId: 'slide_1',
  createdAt: 1,
  updatedAt: 1,
  x: 0.2,
  y: 0.3,
  text: 'note',
};
const operation = createOperation({
  format: 'indicoink-operation',
  version: 1,
  workspaceId,
  streamId: 'deck:deck_1',
  deviceId,
  sequence: 1,
  operationId: 'b59f257a-40d2-4b19-ae71-b2a02f4fe5e6',
  context: {},
  requires: [],
  kind: 'annotation.put',
  payload: {
    annotation,
    documentVersion: null,
    logicalNoteId: annotation.id,
    branchOfOperationId: null,
    resolves: [],
  },
});

describe('sync coordinator', () => {
  it('publishes durable outbox bytes after workspace validation without claiming cloud delivery', async () => {
    let pending: SyncOutboxEntry[] = [
      {
        operation,
        conferenceId: 'conference_1',
        state: 'pending',
        createdAt: 1,
        publishedAt: null,
      },
    ];
    const store = {
      getSyncProfile: vi.fn().mockResolvedValue({
        libraryId: workspaceId,
        deviceId,
        workspaceId,
        folderPath: 'C:\\sync-library',
        enabled: true,
      }),
      createSyncCatalog: vi.fn().mockResolvedValue(null),
      applyRemoteSyncCatalog: vi.fn(),
      getSyncScanQueue: vi.fn().mockResolvedValue([]),
      setSyncScanQueue: vi.fn().mockResolvedValue(undefined),
      listPendingSyncOutbox: vi.fn().mockImplementation(async () => pending),
      countPendingSyncOutbox: vi
        .fn()
        .mockImplementation(async () => pending.length),
      getDeck: vi.fn().mockResolvedValue(null),
      getConference: vi.fn().mockResolvedValue({
        id: 'conference_1',
        sourceUrl: 'https://example.org/event',
      }),
      markSyncOperationPublished: vi.fn().mockImplementation(async () => {
        pending = [];
      }),
      recordDownloadedSyncOperation: vi.fn(),
      listDownloadedSyncOperations: vi.fn().mockResolvedValue([]),
      applyDownloadedAnnotationOperations: vi.fn().mockResolvedValue(false),
    } as unknown as PersistenceStore;
    const published: Array<{ path: string; bytes: Uint8Array }> = [];
    const transport: SyncTransport = {
      initialize: vi.fn().mockResolvedValue({ ready: true }),
      beginScan: vi.fn().mockResolvedValue({ ready: true }),
      publishImmutable: vi.fn().mockImplementation(async (path, bytes) => {
        published.push({ path, bytes });
        return { published: true };
      }),
      replaceCatalog: vi.fn().mockResolvedValue({ replaced: true }),
      readFile: vi.fn().mockResolvedValue(
        new TextEncoder().encode(
          canonicalJson({
            format: 'indicoink-folder-sync',
            version: 1,
            workspaceId,
          }),
        ),
      ),
      enumerateDirectory: vi.fn().mockResolvedValue({
        entries: [],
        nextCursor: null,
        examined: 0,
        partial: false,
      }),
      pause: vi.fn().mockResolvedValue({ paused: true }),
      resume: vi.fn().mockResolvedValue({ paused: false }),
      close: vi.fn(),
    };
    const onStatus = vi.fn();
    const coordinator = new SyncCoordinator(
      store,
      transport,
      onStatus,
      undefined,
      () => 100,
      () => 200,
    );

    const status = await coordinator.start();

    expect(transport.initialize).toHaveBeenCalledWith(
      'C:\\sync-library',
      deviceId,
    );
    expect(published).toHaveLength(1);
    expect(published[0]?.path).toBe(
      `conferences/conference_1/decks/deck_1/ops/${deviceId}/0/1-${operation.operationId}.json`,
    );
    expect(new TextDecoder().decode(published[0]?.bytes)).toBe(
      canonicalJson(operation),
    );
    expect(store.markSyncOperationPublished).toHaveBeenCalledWith(
      operation.operationId,
      200,
    );
    expect(status).toMatchObject({
      state: 'idle',
      pendingChanges: 0,
      cloudDeliveryConfirmed: false,
      lastPublishedAt: 200,
    });
    expect(onStatus).toHaveBeenCalled();

    pending = [
      {
        operation,
        conferenceId: 'conference_wrong',
        state: 'pending',
        createdAt: 2,
        publishedAt: null,
      },
    ];
    const invalidStatus = await coordinator.retryNow();
    expect(invalidStatus).toMatchObject({
      state: 'needs-attention',
      pendingChanges: 1,
    });
    expect(invalidStatus.message).toContain(
      'annotation conference does not match its path',
    );
    expect(published).toHaveLength(1);
    expect(pending).toHaveLength(1);

    const erase = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: 'deck:deck_1',
      deviceId,
      sequence: 1,
      operationId: '56c0257a-40d2-4b19-ae71-b2a02f4fe5e6',
      context: {},
      requires: [],
      kind: 'annotation.erase',
      payload: { annotationId: 'note-1', documentVersion: null },
    });
    pending = [
      {
        operation: erase,
        conferenceId: 'conference_wrong',
        state: 'pending',
        createdAt: 2,
        publishedAt: null,
      },
    ];
    vi.mocked(store.getDeck).mockResolvedValue({
      id: 'deck_1',
      conferenceId: 'conference_1',
    } as never);
    const mismatchedDeckStatus = await coordinator.retryNow();
    expect(mismatchedDeckStatus).toMatchObject({
      state: 'needs-attention',
      pendingChanges: 1,
    });
    expect(mismatchedDeckStatus.message).toContain(
      'different conference than its deck',
    );
    expect(published).toHaveLength(1);
    expect(pending).toHaveLength(1);

    const bookmark = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: 'metadata:conference_1',
      deviceId,
      sequence: 1,
      operationId: 'e1d268ef-2859-46fd-9e0b-40fd60753f2d',
      context: {},
      requires: [],
      kind: 'bookmark.set',
      payload: { talkId: 'talk_1', bookmarked: true },
    });
    pending = [
      {
        operation: bookmark,
        conferenceId: 'conference_1',
        state: 'pending',
        createdAt: 3,
        publishedAt: null,
      },
    ];
    vi.mocked(store.getConference).mockResolvedValue({
      id: 'conference_1',
      sourceUrl: 'https://reader:secret@example.org/event',
    } as never);
    const unsafeStatus = await coordinator.retryNow();
    expect(unsafeStatus.state).toBe('needs-attention');
    expect(unsafeStatus.message).toContain('local-only conference');
    expect(published).toHaveLength(1);
    expect(pending).toHaveLength(1);
    coordinator.close();
  });

  it('retains a legacy pending operation with a credentialed source URL', async () => {
    const sourceUrl = 'https://reader:secret@example.org/event';
    const conferenceId = createConferenceId(sourceUrl);
    const fields = {
      format: 'indicoink-operation' as const,
      version: 1 as const,
      workspaceId,
      streamId: `metadata:${conferenceId}`,
      deviceId,
      sequence: 1,
      operationId: 'b59f257a-40d2-4b19-ae71-b2a02f4fe5e6',
      context: {},
      requires: [],
      kind: 'conference.metadata',
      payload: {
        batchId: '2bb1ca45-4386-46a8-89b5-7f12f3564240',
        partIndex: 0,
        partCount: 1,
        conference: {
          id: conferenceId,
          sourceUrl,
          title: 'Event',
          dates: '',
          host: 'example.org',
          sourceKind: 'indico',
          createdAt: 1,
          updatedAt: 1,
        },
        talks: [],
        decks: [],
        upstreamRevision: null,
      },
    };
    const encoded = new TextEncoder().encode(canonicalJson(fields));
    const legacyOperation = {
      ...fields,
      integrity: {
        byteLength: encoded.byteLength,
        sha256: createHash('sha256').update(encoded).digest('hex'),
      },
    };
    const pending: SyncOutboxEntry[] = [
      {
        operation: legacyOperation,
        conferenceId,
        state: 'pending',
        createdAt: 1,
        publishedAt: null,
      },
    ];
    const store = {
      getSyncProfile: vi.fn().mockResolvedValue({
        libraryId: workspaceId,
        deviceId,
        workspaceId,
        folderPath: 'C:\\sync-library',
        enabled: true,
      }),
      createSyncCatalog: vi.fn().mockResolvedValue(null),
      getSyncScanQueue: vi.fn().mockResolvedValue([]),
      setSyncScanQueue: vi.fn().mockResolvedValue(undefined),
      listPendingSyncOutbox: vi.fn().mockResolvedValue(pending),
      countPendingSyncOutbox: vi.fn().mockResolvedValue(1),
      listDownloadedSyncOperations: vi.fn().mockResolvedValue([]),
      markSyncOperationPublished: vi.fn(),
    } as unknown as PersistenceStore;
    const transport: SyncTransport = {
      initialize: vi.fn().mockResolvedValue({ ready: true }),
      beginScan: vi.fn().mockResolvedValue({ ready: true }),
      publishImmutable: vi.fn(),
      replaceCatalog: vi.fn(),
      readFile: vi.fn().mockResolvedValue(
        new TextEncoder().encode(
          canonicalJson({
            format: 'indicoink-folder-sync',
            version: 1,
            workspaceId,
          }),
        ),
      ),
      enumerateDirectory: vi.fn().mockResolvedValue({
        entries: [],
        nextCursor: null,
        examined: 0,
        partial: false,
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      close: vi.fn(),
    };
    const coordinator = new SyncCoordinator(store, transport, vi.fn());

    const status = await coordinator.start();

    expect(status).toMatchObject({
      state: 'needs-attention',
      pendingChanges: 1,
    });
    expect(status.message).toContain('cannot be published safely');
    expect(transport.publishImmutable).not.toHaveBeenCalled();
    expect(store.markSyncOperationPublished).not.toHaveBeenCalled();
    expect(pending).toHaveLength(1);
    coordinator.close();
  });

  it('keeps a missing configured folder actionable and applies bounded retry delays', async () => {
    const store = {
      getSyncProfile: vi.fn().mockResolvedValue({
        libraryId: workspaceId,
        deviceId,
        workspaceId,
        folderPath: 'C:\\sync-library',
        enabled: true,
      }),
      createSyncCatalog: vi.fn().mockResolvedValue(null),
      applyRemoteSyncCatalog: vi.fn(),
      getSyncScanQueue: vi.fn().mockResolvedValue([]),
      setSyncScanQueue: vi.fn().mockResolvedValue(undefined),
      listPendingSyncOutbox: vi.fn().mockResolvedValue([]),
      countPendingSyncOutbox: vi.fn().mockResolvedValue(0),
    } as unknown as PersistenceStore;
    const timers = {
      setTimeout: vi.fn(() => 42 as unknown as ReturnType<typeof setTimeout>),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(() => 43 as unknown as ReturnType<typeof setInterval>),
      clearInterval: vi.fn(),
    };
    const transport: SyncTransport = {
      initialize: vi.fn().mockResolvedValue({ ready: true }),
      beginScan: vi.fn().mockResolvedValue({ ready: true }),
      publishImmutable: vi.fn(),
      replaceCatalog: vi.fn(),
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT: folder missing')),
      enumerateDirectory: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      close: vi.fn(),
    };
    const coordinator = new SyncCoordinator(
      store,
      transport,
      vi.fn(),
      timers as unknown as ConstructorParameters<typeof SyncCoordinator>[3],
    );

    const status = await coordinator.start();

    expect(status.state).toBe('needs-attention');
    expect(status.message).toContain('Sync folder unavailable');
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 2000);
    vi.mocked(transport.readFile).mockResolvedValueOnce(
      new TextEncoder().encode('{}'),
    );
    const invalidStatus = await coordinator.retryNow();
    expect(invalidStatus.message).toContain('Sync needs attention');
    expect(invalidStatus.message).toContain('workspace record is invalid');
    coordinator.close();
  });

  it('applies queued changes for the prior deck when the viewer switches decks', async () => {
    const store = {
      getSyncProfile: vi.fn().mockResolvedValue({
        libraryId: workspaceId,
        deviceId,
        workspaceId,
        folderPath: 'C:\\sync-library',
        enabled: true,
      }),
      createSyncCatalog: vi.fn().mockResolvedValue(null),
      getSyncScanQueue: vi.fn().mockResolvedValue([]),
      setSyncScanQueue: vi.fn().mockResolvedValue(undefined),
      listDownloadedSyncOperations: vi.fn().mockResolvedValue([operation]),
      applyDownloadedAnnotationOperations: vi.fn().mockResolvedValue(true),
      listPendingSyncOutbox: vi.fn().mockResolvedValue([]),
      countPendingSyncOutbox: vi.fn().mockResolvedValue(0),
    } as unknown as PersistenceStore;
    const transport: SyncTransport = {
      initialize: vi.fn().mockResolvedValue({ ready: true }),
      beginScan: vi.fn().mockResolvedValue({ ready: true }),
      publishImmutable: vi.fn(),
      replaceCatalog: vi.fn(),
      readFile: vi.fn().mockResolvedValue(
        new TextEncoder().encode(
          canonicalJson({
            format: 'indicoink-folder-sync',
            version: 1,
            workspaceId,
          }),
        ),
      ),
      enumerateDirectory: vi.fn().mockResolvedValue({
        entries: [],
        nextCursor: null,
        examined: 0,
        partial: false,
      }),
      pause: vi.fn().mockResolvedValue({ paused: true }),
      resume: vi.fn().mockResolvedValue({ paused: false }),
      close: vi.fn(),
    };
    const coordinator = new SyncCoordinator(
      store,
      transport,
      vi.fn(),
      undefined,
      () => 100,
      () => 200,
    );
    coordinator.setActiveDeck('deck_1');
    await coordinator.start();
    expect(store.applyDownloadedAnnotationOperations).not.toHaveBeenCalled();

    vi.mocked(transport.initialize).mockRejectedValueOnce(
      new Error('Sync folder unavailable'),
    );
    coordinator.setActiveDeck('deck_2');
    await vi.waitFor(() => {
      expect(store.applyDownloadedAnnotationOperations).toHaveBeenCalledWith(
        'deck:deck_1',
      );
    });
    await vi.waitFor(() => {
      expect(coordinator.getStatus().state).toBe('needs-attention');
    });
    expect(coordinator.getStatus().peerReceivedAt).toBe(200);
    coordinator.close();
  });

  it('records a peer receipt before a later publication failure', async () => {
    const store = {
      getSyncProfile: vi.fn().mockResolvedValue({
        libraryId: workspaceId,
        deviceId,
        workspaceId,
        folderPath: 'C:\\sync-library',
        enabled: true,
      }),
      createSyncCatalog: vi.fn().mockResolvedValue(null),
      getSyncScanQueue: vi.fn().mockResolvedValue([]),
      setSyncScanQueue: vi.fn().mockResolvedValue(undefined),
      listDownloadedSyncOperations: vi
        .fn()
        .mockResolvedValue([{ streamId: 'metadata:conference_1' }]),
      applyDownloadedMetadataOperations: vi.fn().mockResolvedValue(true),
      listPendingSyncOutbox: vi
        .fn()
        .mockRejectedValue(new Error('disk unavailable')),
    } as unknown as PersistenceStore;
    const transport: SyncTransport = {
      initialize: vi.fn().mockResolvedValue({ ready: true }),
      beginScan: vi.fn().mockResolvedValue({ ready: true }),
      publishImmutable: vi.fn(),
      replaceCatalog: vi.fn(),
      readFile: vi.fn().mockResolvedValue(
        new TextEncoder().encode(
          canonicalJson({
            format: 'indicoink-folder-sync',
            version: 1,
            workspaceId,
          }),
        ),
      ),
      enumerateDirectory: vi.fn().mockResolvedValue({
        entries: [],
        nextCursor: null,
        examined: 0,
        partial: false,
      }),
      pause: vi.fn().mockResolvedValue({ paused: true }),
      resume: vi.fn(),
      close: vi.fn(),
    };
    const coordinator = new SyncCoordinator(
      store,
      transport,
      vi.fn(),
      undefined,
      () => 100,
      () => 200,
    );

    await coordinator.start();

    expect(store.applyDownloadedMetadataOperations).toHaveBeenCalledWith(
      'metadata:conference_1',
    );
    expect(coordinator.getStatus()).toMatchObject({
      state: 'needs-attention',
      peerReceivedAt: 200,
    });
    coordinator.close();
  });

  it('preserves the import time when the rest of the attempt finishes later', async () => {
    const store = {
      getSyncProfile: vi.fn().mockResolvedValue({
        libraryId: workspaceId,
        deviceId,
        workspaceId,
        folderPath: 'C:\\sync-library',
        enabled: true,
      }),
      createSyncCatalog: vi.fn().mockResolvedValue(null),
      getSyncScanQueue: vi.fn().mockResolvedValue([]),
      setSyncScanQueue: vi.fn().mockResolvedValue(undefined),
      listDownloadedSyncOperations: vi
        .fn()
        .mockResolvedValueOnce([{ streamId: 'metadata:conference_1' }])
        .mockResolvedValue([]),
      applyDownloadedMetadataOperations: vi.fn().mockResolvedValue(true),
      listPendingSyncOutbox: vi.fn().mockResolvedValue([]),
    } as unknown as PersistenceStore;
    const transport: SyncTransport = {
      initialize: vi.fn().mockResolvedValue({ ready: true }),
      beginScan: vi.fn().mockResolvedValue({ ready: true }),
      publishImmutable: vi.fn(),
      replaceCatalog: vi.fn(),
      readFile: vi.fn().mockResolvedValue(
        new TextEncoder().encode(
          canonicalJson({
            format: 'indicoink-folder-sync',
            version: 1,
            workspaceId,
          }),
        ),
      ),
      enumerateDirectory: vi.fn().mockResolvedValue({
        entries: [],
        nextCursor: null,
        examined: 0,
        partial: false,
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      close: vi.fn(),
    };
    let now = 200;
    vi.mocked(store.listPendingSyncOutbox).mockImplementation(async () => {
      now = 300;
      return [];
    });
    const coordinator = new SyncCoordinator(
      store,
      transport,
      vi.fn(),
      undefined,
      () => 100,
      () => now,
    );

    await coordinator.start();

    expect(coordinator.getStatus()).toMatchObject({
      state: 'idle',
      peerReceivedAt: 200,
      lastCheckedAt: 300,
    });
    coordinator.close();
  });

  it('does not continue a download attempt after pause while an import is applying', async () => {
    let resolveApply!: (applied: boolean) => void;
    const applying = new Promise<boolean>((resolve) => {
      resolveApply = resolve;
    });
    const store = {
      getSyncProfile: vi.fn().mockResolvedValue({
        libraryId: workspaceId,
        deviceId,
        workspaceId,
        folderPath: 'C:\\sync-library',
        enabled: true,
      }),
      createSyncCatalog: vi.fn().mockResolvedValue(null),
      getSyncScanQueue: vi.fn().mockResolvedValue([]),
      setSyncScanQueue: vi.fn().mockResolvedValue(undefined),
      listDownloadedSyncOperations: vi
        .fn()
        .mockResolvedValue([{ streamId: 'metadata:conference_1' }]),
      applyDownloadedMetadataOperations: vi.fn().mockReturnValue(applying),
      listPendingSyncOutbox: vi.fn().mockResolvedValue([]),
      countPendingSyncOutbox: vi.fn().mockResolvedValue(0),
    } as unknown as PersistenceStore;
    const transport: SyncTransport = {
      initialize: vi.fn().mockResolvedValue({ ready: true }),
      beginScan: vi.fn().mockResolvedValue({ ready: true }),
      publishImmutable: vi.fn(),
      replaceCatalog: vi.fn(),
      readFile: vi.fn().mockResolvedValue(
        new TextEncoder().encode(
          canonicalJson({
            format: 'indicoink-folder-sync',
            version: 1,
            workspaceId,
          }),
        ),
      ),
      enumerateDirectory: vi.fn().mockResolvedValue({
        entries: [],
        nextCursor: null,
        examined: 0,
        partial: false,
      }),
      pause: vi.fn().mockResolvedValue({ paused: true }),
      resume: vi.fn(),
      close: vi.fn(),
    };
    const coordinator = new SyncCoordinator(store, transport, vi.fn());
    const starting = coordinator.start();
    await vi.waitFor(() => {
      expect(store.applyDownloadedMetadataOperations).toHaveBeenCalled();
    });

    const pausing = coordinator.pause();
    resolveApply(true);
    await Promise.all([starting, pausing]);

    expect(store.listPendingSyncOutbox).not.toHaveBeenCalled();
    expect(coordinator.getStatus()).toMatchObject({
      state: 'paused',
      peerReceivedAt: null,
    });
    coordinator.close();
  });
});
