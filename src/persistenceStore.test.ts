import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { describe, expect, it } from 'vitest';

import { createConferenceId, createSlideId } from './persistenceModels';
import { createDeckId, createTalkId } from './persistenceModels';
import { createOperation } from './syncProtocol';
import { PersistenceStore } from './persistenceStore';
import type { PdfWorkspaceChangeBatch } from './shared/pdfWorkspace';
import { createWorkspaceHistory } from './workspaceHistory';

const createTempDbPath = (name: string) =>
  join(
    mkdtempSync(join(tmpdir(), 'indicoink-persistence-')),
    `${name}.sqlite3`,
  );

const getSqlWasmPath = () => {
  if (sqlWasmUrl.startsWith('/node_modules/')) {
    return join(process.cwd(), sqlWasmUrl.slice(1));
  }

  return isAbsolute(sqlWasmUrl) ? sqlWasmUrl : join(process.cwd(), sqlWasmUrl);
};

describe('persistence store', () => {
  it('creates a stable per-library sync identity and sync ledgers', async () => {
    const dbPath = createTempDbPath('sync-schema');
    const firstStore = new PersistenceStore(dbPath, () => 1700000000000);
    const firstProfile = await firstStore.getSyncProfile();

    expect(firstProfile.libraryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(firstProfile.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(firstProfile).toMatchObject({
      workspaceId: null,
      folderPath: null,
      enabled: false,
    });
    await firstStore.close();

    const reopenedStore = new PersistenceStore(dbPath, () => 1700000001000);
    await expect(reopenedStore.getSyncProfile()).resolves.toEqual(firstProfile);
    await expect(reopenedStore.listConferences()).resolves.toEqual([]);
    await reopenedStore.close();

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const tableNames = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map(({ name }) => name),
    );
    db.close();
    expect(tableNames.size).toBeGreaterThan(0);
    for (const table of [
      'sync_profile',
      'sync_stream_state',
      'sync_outbox',
      'sync_inbox',
      'sync_conflicts',
      'sync_catalog_state',
      'sync_checkpoints',
      'sync_document_versions',
      'sync_annotation_versions',
      'sync_retirements',
      'sync_legacy_version_migration',
      'sync_hidden_conferences',
    ]) {
      expect(tableNames.has(table), `${table} migration`).toBe(true);
    }
  });

  it('publishes a fresh catalog generation when the workspace changes', async () => {
    const store = new PersistenceStore(
      createTempDbPath('sync-catalog-workspace'),
      () => 1700000000000,
    );
    const profile = await store.getSyncProfile();
    const firstWorkspace = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
    const secondWorkspace = '8b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
    await store.setSyncConfiguration({
      workspaceId: firstWorkspace,
      folderPath: 'C:\\first-sync-library',
      enabled: true,
    });
    const firstCatalog = await store.createSyncCatalog();
    expect(firstCatalog).toMatchObject({
      workspaceId: firstWorkspace,
      deviceId: profile.deviceId,
      generation: 1,
    });

    await store.setSyncConfiguration({
      workspaceId: secondWorkspace,
      folderPath: 'C:\\second-sync-library',
      enabled: true,
    });
    const secondCatalog = await store.createSyncCatalog();
    expect(secondCatalog).toMatchObject({
      workspaceId: secondWorkspace,
      deviceId: profile.deviceId,
      generation: 1,
    });
    await store.close();
  });

  it('keeps local-only conferences out of the shared discovery catalog', async () => {
    const store = new PersistenceStore(
      createTempDbPath('sync-catalog-local-only'),
      () => 1700000000000,
    );
    await store.upsertConference({
      id: 'local-conference',
      sourceUrl: 'C:\\private\\agenda.json',
      title: 'Private agenda',
      dates: '',
      host: '',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertConference({
      id: createConferenceId('https://example.org/public-event'),
      sourceUrl: 'https://example.org/public-event',
      title: 'Public event',
      dates: '',
      host: 'example.org',
      sourceKind: 'web',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    const credentialedUrl = 'https://name:secret@example.org/private-event';
    const credentialedId = createConferenceId(credentialedUrl);
    await store.upsertConference({
      id: credentialedId,
      sourceUrl: credentialedUrl,
      title: 'Credentialed event',
      dates: '',
      host: 'example.org',
      sourceKind: 'web',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.setSyncConfiguration({
      workspaceId: '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d',
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    const catalog = await store.createSyncCatalog();
    expect(catalog?.conferences.map((conference) => conference.title)).toEqual([
      'Public event',
    ]);
    expect(await store.recordLocalSyncMetadataSnapshot(credentialedId)).toBe(0);
    await store.requeueSyncEligibleMetadata();
    expect(
      (await store.listPendingSyncOutbox()).some(
        (entry) => entry.conferenceId === credentialedId,
      ),
    ).toBe(false);
    await store.close();
  });

  it('does not enqueue metadata with credentialed talk or deck URLs', async () => {
    const store = new PersistenceStore(
      createTempDbPath('sync-credentialed-metadata'),
      () => 1700000000000,
    );
    const conferenceUrl = 'https://example.org/event';
    const conferenceId = createConferenceId(conferenceUrl);
    const talkId = createTalkId(conferenceId, '42');
    const deckUrl = 'https://example.org/slides.pdf';
    const deckId = createDeckId(talkId, deckUrl);
    await store.upsertConference({
      id: conferenceId,
      sourceUrl: conferenceUrl,
      title: 'Event',
      dates: '',
      host: 'example.org',
      sourceKind: 'web',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    const talk = {
      id: talkId,
      conferenceId,
      contributionId: '42',
      contributionUrl: 'https://example.org/talk?token=secret',
      title: 'Talk',
      speaker: '',
      sessionTitle: '',
      startsAt: null,
      endsAt: null,
      room: '',
      bookmarked: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    await store.upsertTalk(talk);
    await store.setSyncConfiguration({
      workspaceId: '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d',
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    expect(await store.recordLocalSyncMetadataSnapshot(conferenceId)).toBe(0);
    await store.requeueSyncEligibleMetadata();
    expect(await store.listPendingSyncOutbox()).toEqual([]);

    await store.upsertTalk({
      ...talk,
      contributionUrl: 'https://example.org/talk',
      linkedAgendaUrl: 'https://reader:secret@example.org/agenda',
    });
    expect(await store.recordLocalSyncMetadataSnapshot(conferenceId)).toBe(0);
    await store.upsertTalk({
      ...talk,
      contributionUrl: 'https://example.org/talk',
      linkedAgendaUrl: '',
    });
    await store.upsertDeck({
      id: deckId,
      conferenceId,
      talkId,
      sourceUrl: 'https://example.org/slides.pdf?signature=secret',
      displayName: 'Slides',
      mimeType: 'application/pdf',
      selected: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    expect(await store.recordLocalSyncMetadataSnapshot(conferenceId)).toBe(0);
    expect(await store.listPendingSyncOutbox()).toEqual([]);
    await store.upsertDeck({
      id: deckId,
      conferenceId,
      talkId,
      sourceUrl: deckUrl,
      displayName: 'Slides',
      mimeType: 'application/pdf',
      selected: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    expect(await store.recordLocalSyncMetadataSnapshot(conferenceId)).toBe(1);
    expect(await store.listPendingSyncOutbox()).toHaveLength(1);
    await store.close();
  });

  it('does not restore a locally deleted conference from an unchanged catalog', async () => {
    const store = new PersistenceStore(
      createTempDbPath('sync-catalog-repeat'),
      () => 1700000000000,
    );
    const profile = await store.getSyncProfile();
    const workspaceId = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    const conferenceUrl = 'https://example.org/remote-event';
    const conferenceId = createConferenceId(conferenceUrl);
    const catalog = {
      format: 'indicoink-catalog',
      version: 1,
      workspaceId,
      deviceId: '72fc257a-40d2-4b19-ae71-b2a02f4fe5e6',
      generation: 1,
      updatedAt: 1700000000000,
      conferences: [
        {
          conferenceId,
          sourceKind: 'web',
          sourceUrl: conferenceUrl,
          title: 'Remote event',
          dates: '',
          host: 'example.org',
          metadataSnapshotId: null,
        },
      ],
    } as const;
    expect(catalog.deviceId).not.toBe(profile.deviceId);
    await expect(store.applyRemoteSyncCatalog(catalog)).resolves.toBe(true);
    await store.deleteConference(conferenceId);
    await expect(store.applyRemoteSyncCatalog(catalog)).resolves.toBe(false);
    await expect(
      store.applyRemoteSyncCatalog({
        ...catalog,
        generation: 2,
        updatedAt: 1700000001000,
        conferences: catalog.conferences.map((conference) => ({
          ...conference,
          title: 'Updated remote event',
        })),
      }),
    ).resolves.toBe(true);
    await expect(store.listConferences()).resolves.toEqual([]);
    await expect(store.getConference(conferenceId)).resolves.toMatchObject({
      title: 'Remote event',
    });
    await store.close();
  });

  it('records explicit shared conference deletion and retains its local payload', async () => {
    const store = new PersistenceStore(
      createTempDbPath('sync-conference-delete'),
      () => 1700000000000,
    );
    await store.upsertConference({
      id: 'conference-delete',
      sourceUrl: 'https://example.org/delete-event',
      title: 'Delete event',
      dates: '',
      host: 'example.org',
      sourceKind: 'web',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.setSyncConfiguration({
      workspaceId: '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d',
      folderPath: 'C:\\sync-library',
      enabled: true,
    });

    await store.deleteConference('conference-delete');

    await expect(store.listConferences()).resolves.toEqual([]);
    await expect(
      store.getConference('conference-delete'),
    ).resolves.toMatchObject({
      title: 'Delete event',
    });
    await expect(store.listPendingSyncOutbox()).resolves.toMatchObject([
      {
        operation: {
          streamId: 'metadata:conference-delete',
          kind: 'conference.delete',
          payload: { reason: 'user' },
        },
      },
    ]);
    await store.close();
  });

  it('commits local annotation changes with a durable library-scoped outbox operation', async () => {
    const dbPath = createTempDbPath('sync-outbox');
    let store = new PersistenceStore(dbPath, () => 1700000000000);
    const profile = await store.getSyncProfile();
    const workspaceId = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
    await store.upsertConference({
      id: 'conference-sync',
      sourceUrl: 'https://example.org/event',
      title: 'Sync Event',
      dates: '',
      host: 'example.org',
      sourceKind: 'web',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertTalk({
      id: 'talk-sync',
      conferenceId: 'conference-sync',
      contributionId: 'talk-1',
      contributionUrl: 'https://example.org/event/talk-1',
      title: 'Sync Talk',
      speaker: '',
      sessionTitle: '',
      startsAt: null,
      endsAt: null,
      room: '',
      bookmarked: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertDeck({
      id: 'deck_sync',
      conferenceId: 'conference-sync',
      talkId: 'talk-sync',
      sourceUrl: 'https://example.org/event/talk-1/slides.pdf',
      displayName: 'Slides',
      mimeType: 'application/pdf',
      selected: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: true,
    });

    const save = (
      revision: number,
      changes: PdfWorkspaceChangeBatch['changes'],
    ) =>
      store.saveDeckPdfWorkspaceChanges({
        sourceUrl: 'https://example.org/event/talk-1/slides.pdf',
        conferenceId: 'conference-sync',
        talkId: 'talk-sync',
        deckId: 'deck_sync',
        pageCount: 1,
        revision,
        changes,
        history: createWorkspaceHistory(),
        currentSlideNumber: 1,
        scrollLeft: 0,
        scrollTop: 0,
        zoom: 1,
      });

    const note = {
      id: 'note-sync',
      conferenceId: 'conference-sync',
      talkId: 'talk-sync',
      deckId: 'deck_sync',
      slideId: createSlideId('deck_sync', 1),
      x: 0.25,
      y: 0.5,
      width: 240,
      text: 'Saved before sync',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    await save(1, [{ kind: 'upsert-text-note', pageIndex: 0, note }]);

    const [pending] = await store.listPendingSyncOutbox();
    expect(pending?.conferenceId).toBe('conference-sync');
    expect(pending?.operation).toMatchObject({
      workspaceId,
      streamId: 'deck:deck_sync',
      deviceId: profile.deviceId,
      sequence: 1,
      kind: 'annotation.put',
      payload: {
        documentVersion: null,
        logicalNoteId: 'note-sync',
        resolves: [],
      },
    });
    expect(await store.getAnnotation('note-sync')).toMatchObject({
      text: 'Saved before sync',
    });

    await store.close();
    const measuredDb = new DatabaseSync(dbPath);
    measuredDb
      .prepare(
        `UPDATE sync_document_versions
         SET document_version = ?, version_state = 'known'
         WHERE deck_id = ?`,
      )
      .run('a'.repeat(64), 'deck_sync');
    measuredDb.close();
    store = new PersistenceStore(dbPath, () => 1700000000000);

    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: false,
    });
    await save(2, [
      {
        kind: 'upsert-text-note',
        pageIndex: 0,
        note: { ...note, text: 'Edited while paused' },
      },
    ]);
    await expect(store.listPendingSyncOutbox()).resolves.toEqual([]);
    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    const resumed = await store.listPendingSyncOutbox();
    expect(resumed.map((entry) => entry.operation.sequence)).toEqual([1, 2]);
    expect(resumed[1]?.operation.payload).toMatchObject({
      documentVersion: null,
    });

    await store.setSyncConfiguration({
      workspaceId: null,
      folderPath: null,
      enabled: false,
    });
    await save(3, [
      {
        kind: 'upsert-text-note',
        pageIndex: 0,
        note: { ...note, text: 'Edited after disconnect' },
      },
    ]);
    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    expect(await store.listPendingSyncOutbox()).toHaveLength(2);

    await store.setSyncConfiguration({
      workspaceId: '8b9e7cb4-8335-4a1a-9f4d-04a5986cc02d',
      folderPath: 'C:\\other-library',
      enabled: true,
    });
    await expect(store.listPendingSyncOutbox()).resolves.toEqual([]);

    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    await expect(store.listPendingSyncOutbox()).resolves.toHaveLength(2);
    await store.markSyncOperationPublished(pending!.operation.operationId);
    await expect(store.listPendingSyncOutbox()).resolves.toHaveLength(1);

    await expect(
      save(4, [
        {
          kind: 'upsert-text-note',
          pageIndex: 0,
          note: { ...note, text: 'x'.repeat(16_385) },
        },
      ]),
    ).rejects.toThrow();
    expect(await store.getAnnotation('note-sync')).toMatchObject({
      text: 'Edited after disconnect',
    });
    await expect(store.listPendingSyncOutbox()).resolves.toHaveLength(1);
    await store.close();
    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(
      db
        .prepare('SELECT revision FROM workspace_revision WHERE deck_id = ?')
        .get('deck_sync'),
    ).toMatchObject({ revision: 3 });
    db.close();
  });

  it('imports complete remote conference metadata and bookmarks idempotently', async () => {
    const store = new PersistenceStore(
      createTempDbPath('sync-metadata-import'),
      () => 1700000000000,
    );
    const workspaceId = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
    const remoteDeviceId = '72fc257a-40d2-4b19-ae71-b2a02f4fe5e6';
    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    const sourceUrl = 'https://example.org/metadata-event';
    const conferenceId = createConferenceId(sourceUrl);
    const talkUrl = `${sourceUrl}/talk-1`;
    const talkId = createTalkId(conferenceId, 'talk-1');
    const deckUrl = `${talkUrl}/slides.pdf`;
    const deckId = createDeckId(talkId, deckUrl);
    const operation = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: `metadata:${conferenceId}`,
      deviceId: remoteDeviceId,
      sequence: 1,
      operationId: randomUUID(),
      context: {},
      requires: [],
      kind: 'conference.metadata',
      payload: {
        batchId: randomUUID(),
        partIndex: 0,
        partCount: 1,
        conference: {
          id: conferenceId,
          sourceUrl,
          title: 'Shared event',
          dates: '2026-10-17',
          host: 'example.org',
          sourceKind: 'web',
          timeZone: null,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
        talks: [
          {
            id: talkId,
            conferenceId,
            contributionId: 'talk-1',
            contributionUrl: talkUrl,
            title: 'Shared talk',
            speaker: 'A speaker',
            sessionTitle: '',
            startsAt: null,
            endsAt: null,
            room: '',
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
        decks: [
          {
            id: deckId,
            conferenceId,
            talkId,
            sourceUrl: deckUrl,
            displayName: 'Slides',
            mimeType: 'application/pdf',
            kind: 'pdf',
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
        upstreamRevision: 'rev-1',
      },
    });
    const bookmark = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: `metadata:${conferenceId}`,
      deviceId: remoteDeviceId,
      sequence: 2,
      operationId: randomUUID(),
      context: { [remoteDeviceId]: 1 },
      requires: [],
      kind: 'bookmark.set',
      payload: { talkId, bookmarked: true },
    });
    await store.recordDownloadedSyncOperation(operation);
    await store.recordDownloadedSyncOperation(bookmark);

    await expect(
      store.applyDownloadedMetadataOperations(`metadata:${conferenceId}`),
    ).resolves.toBe(true);
    await expect(store.getConference(conferenceId)).resolves.toMatchObject({
      title: 'Shared event',
      sourceUrl,
    });
    await expect(store.getTalk(talkId)).resolves.toMatchObject({
      title: 'Shared talk',
      bookmarked: true,
    });
    await expect(store.getDeck(deckId)).resolves.toMatchObject({
      displayName: 'Slides',
    });
    const deletion = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: `metadata:${conferenceId}`,
      deviceId: remoteDeviceId,
      sequence: 3,
      operationId: randomUUID(),
      context: { [remoteDeviceId]: 2 },
      requires: [],
      kind: 'conference.delete',
      payload: { deletedAt: 1700000002000, reason: 'user' },
    });
    await store.recordDownloadedSyncOperation(deletion);
    await expect(
      store.applyDownloadedMetadataOperations(`metadata:${conferenceId}`),
    ).resolves.toBe(true);
    await expect(store.listConferences()).resolves.toEqual([]);
    await expect(store.getConference(conferenceId)).resolves.toMatchObject({
      title: 'Shared event',
    });
    await expect(
      store.applyDownloadedMetadataOperations(`metadata:${conferenceId}`),
    ).resolves.toBe(false);
    await store.close();
  });

  it('rejects a bookmark routed through another conference stream', async () => {
    const store = new PersistenceStore(
      createTempDbPath('sync-bookmark-route'),
      () => 1700000000000,
    );
    const workspaceId = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
    const remoteDeviceId = '72fc257a-40d2-4b19-ae71-b2a02f4fe5e6';
    await store.upsertConference({
      id: 'conference-b',
      sourceUrl: 'https://example.org/b',
      title: 'B',
      dates: '',
      host: 'example.org',
      sourceKind: 'web',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertTalk({
      id: 'talk-b',
      conferenceId: 'conference-b',
      contributionId: 'talk-b',
      contributionUrl: 'https://example.org/b/talk-b',
      title: 'Talk B',
      speaker: '',
      sessionTitle: '',
      startsAt: null,
      endsAt: null,
      room: '',
      bookmarked: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    const misrouted = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: 'metadata:conference-a',
      deviceId: remoteDeviceId,
      sequence: 1,
      operationId: randomUUID(),
      context: {},
      requires: [],
      kind: 'bookmark.set',
      payload: { talkId: 'talk-b', bookmarked: true },
    });
    await store.recordDownloadedSyncOperation(misrouted);
    await expect(
      store.applyDownloadedMetadataOperations('metadata:conference-a'),
    ).rejects.toThrow('does not match its conference stream');
    await expect(store.getTalk('talk-b')).resolves.toMatchObject({
      bookmarked: false,
    });
    await store.close();
  });

  it('rejects remote metadata that attaches a deck to a talk in another conference', async () => {
    const store = new PersistenceStore(
      createTempDbPath('sync-deck-route'),
      () => 1700000000000,
    );
    const workspaceId = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
    const remoteDeviceId = '72fc257a-40d2-4b19-ae71-b2a02f4fe5e6';
    const sourceUrl = 'https://example.org/a';
    const conferenceId = createConferenceId(sourceUrl);
    const otherConferenceId = createConferenceId('https://example.org/b');
    const otherTalkId = createTalkId(otherConferenceId, 'talk-b');
    await store.upsertConference({
      id: otherConferenceId,
      sourceUrl: 'https://example.org/b',
      title: 'B',
      dates: '',
      host: 'example.org',
      sourceKind: 'web',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertTalk({
      id: otherTalkId,
      conferenceId: otherConferenceId,
      contributionId: 'talk-b',
      contributionUrl: 'https://example.org/b/talk-b',
      title: 'Talk B',
      speaker: '',
      sessionTitle: '',
      startsAt: null,
      endsAt: null,
      room: '',
      bookmarked: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    const deckUrl = 'https://example.org/b/talk-b/slides.pdf';
    const misrouted = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: `metadata:${conferenceId}`,
      deviceId: remoteDeviceId,
      sequence: 1,
      operationId: randomUUID(),
      context: {},
      requires: [],
      kind: 'conference.metadata',
      payload: {
        batchId: randomUUID(),
        partIndex: 0,
        partCount: 1,
        conference: {
          id: conferenceId,
          sourceUrl,
          title: 'A',
          dates: '',
          host: 'example.org',
          sourceKind: 'web',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
        talks: [],
        decks: [
          {
            id: createDeckId(otherTalkId, deckUrl),
            conferenceId,
            talkId: otherTalkId,
            sourceUrl: deckUrl,
            displayName: 'Slides',
            mimeType: 'application/pdf',
            kind: 'pdf',
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
        upstreamRevision: null,
      },
    });
    await store.recordDownloadedSyncOperation(misrouted);
    await expect(
      store.applyDownloadedMetadataOperations(`metadata:${conferenceId}`),
    ).rejects.toThrow('does not match its conference metadata');
    await expect(store.getConference(conferenceId)).resolves.toBeNull();
    await store.close();
  });

  it('clears legacy sync annotations, repairs slide counts, and preserves stream sequence', async () => {
    const dbPath = createTempDbPath('sync-clear-annotations');
    const store = new PersistenceStore(dbPath, () => 1700000000000);
    const workspaceId = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
    await store.upsertConference({
      id: 'conference-clear',
      sourceUrl: 'https://example.org/clear-event',
      title: 'Clear Event',
      dates: '',
      host: 'example.org',
      sourceKind: 'web',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertTalk({
      id: 'talk-clear',
      conferenceId: 'conference-clear',
      contributionId: 'talk-1',
      contributionUrl: 'https://example.org/clear-event/talk-1',
      title: 'Clear Talk',
      speaker: '',
      sessionTitle: '',
      startsAt: null,
      endsAt: null,
      room: '',
      bookmarked: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertDeck({
      id: 'deck_clear',
      conferenceId: 'conference-clear',
      talkId: 'talk-clear',
      sourceUrl: 'https://example.org/clear-event/slides.pdf',
      displayName: 'Slides',
      mimeType: 'application/pdf',
      selected: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    const note = {
      id: 'note-clear',
      conferenceId: 'conference-clear',
      talkId: 'talk-clear',
      deckId: 'deck_clear',
      slideId: createSlideId('deck_clear', 1),
      x: 0.25,
      y: 0.5,
      width: 240,
      text: 'Legacy note',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    await store.saveDeckPdfWorkspaceChanges({
      sourceUrl: 'https://example.org/clear-event/slides.pdf',
      conferenceId: 'conference-clear',
      talkId: 'talk-clear',
      deckId: 'deck_clear',
      pageCount: 1,
      revision: 1,
      changes: [{ kind: 'upsert-text-note', pageIndex: 0, note }],
      history: createWorkspaceHistory(),
      currentSlideNumber: 1,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
    });
    await store.saveDeckPdfWorkspaceChanges({
      sourceUrl: 'https://example.org/clear-event/slides.pdf',
      conferenceId: 'conference-clear',
      talkId: 'talk-clear',
      deckId: 'deck_clear',
      pageCount: 1,
      revision: 2,
      changes: [{ kind: 'delete', pageIndex: 0, annotationId: 'note-clear' }],
      history: createWorkspaceHistory(),
      currentSlideNumber: 1,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
    });
    const pending = await store.listPendingSyncOutbox();
    expect(pending.map((entry) => entry.operation.kind)).toEqual([
      'annotation.put',
      'annotation.erase',
    ]);

    await store.close();
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb
      .prepare('DELETE FROM sync_annotation_versions WHERE annotation_id = ?')
      .run('note-clear');
    legacyDb.close();

    const reopenedStore = new PersistenceStore(dbPath, () => 1700000000000);
    await reopenedStore.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: false,
    });
    await expect(
      reopenedStore.listPendingSyncOutboxForWorkspace(workspaceId),
    ).resolves.toHaveLength(2);
    await reopenedStore.clearSyncEligibleAnnotations(workspaceId);
    await expect(reopenedStore.getAnnotation('note-clear')).resolves.toBeNull();
    await reopenedStore.close();

    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(
      db
        .prepare('SELECT annotated FROM slides WHERE id = ?')
        .get(createSlideId('deck_clear', 1)),
    ).toMatchObject({ annotated: 0 });
    const outbox = db
      .prepare('SELECT operation_json FROM sync_outbox')
      .all() as Array<{ operation_json: string }>;
    expect(outbox.map((row) => JSON.parse(row.operation_json))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: pending[0]!.operation.operationId,
          sequence: pending[0]!.operation.sequence,
          kind: 'noop',
          payload: {},
        }),
        expect.objectContaining({
          operationId: pending[1]!.operation.operationId,
          sequence: pending[1]!.operation.sequence,
          kind: 'noop',
          payload: {},
        }),
      ]),
    );
    expect(
      db
        .prepare(
          'SELECT annotation_id FROM sync_suppressed_annotations WHERE workspace_id = ? AND annotation_id = ?',
        )
        .get(workspaceId, 'note-clear'),
    ).toBeDefined();
    db.close();
  });

  it('upgrades a version 9 library without replacing its existing records', async () => {
    const dbPath = createTempDbPath('sync-upgrade');
    const seedStore = new PersistenceStore(dbPath, () => 1700000000000);
    await seedStore.upsertConference({
      id: 'conference-1',
      sourceUrl: 'https://example.org/event',
      title: 'Existing conference',
      dates: '',
      host: 'example.org',
      timeZone: null,
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await seedStore.upsertTalk({
      id: 'talk-1',
      conferenceId: 'conference-1',
      contributionId: '1',
      contributionUrl: 'https://example.org/event/contributions/1/',
      title: 'Existing talk',
      speaker: '',
      sessionTitle: '',
      startsAt: null,
      endsAt: null,
      room: '',
      bookmarked: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await seedStore.upsertDeck({
      id: 'deck-1',
      conferenceId: 'conference-1',
      talkId: 'talk-1',
      sourceUrl: 'https://example.org/slides.pdf',
      displayName: 'Existing PDF',
      mimeType: 'application/pdf',
      selected: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await seedStore.upsertSlide({
      id: createSlideId('deck-1', 1),
      conferenceId: 'conference-1',
      talkId: 'talk-1',
      deckId: 'deck-1',
      slideNumber: 1,
      annotated: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await seedStore.upsertAnnotation({
      id: 'note-1',
      conferenceId: 'conference-1',
      talkId: 'talk-1',
      deckId: 'deck-1',
      slideId: createSlideId('deck-1', 1),
      x: 0.25,
      y: 0.5,
      width: 0.4,
      text: 'Existing note',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await seedStore.close();

    const priorSchema = new DatabaseSync(dbPath);
    priorSchema.exec(`
      DROP TABLE sync_retirements;
      DROP TABLE sync_legacy_version_migration;
      DROP TABLE sync_annotation_versions;
      DROP TABLE sync_document_versions;
      DROP TABLE sync_checkpoints;
      DROP TABLE sync_catalog_state;
      DROP TABLE sync_conflicts;
      DROP TABLE sync_inbox;
      DROP TABLE sync_outbox;
      DROP TABLE sync_stream_state;
      DROP TABLE sync_profile;
      PRAGMA user_version = 9;
    `);
    priorSchema.close();

    const upgradedStore = new PersistenceStore(dbPath, () => 1700000001000);
    await expect(upgradedStore.getSyncProfile()).resolves.toMatchObject({
      enabled: false,
      workspaceId: null,
    });
    await expect(
      upgradedStore.getConference('conference-1'),
    ).resolves.toMatchObject({
      title: 'Existing conference',
    });
    await expect(upgradedStore.getAnnotation('note-1')).resolves.toMatchObject({
      text: 'Existing note',
      width: 0.4,
    });
    await upgradedStore.close();

    const upgradedDb = new DatabaseSync(dbPath, { readOnly: true });
    expect(
      (
        upgradedDb.prepare('PRAGMA user_version').get() as {
          user_version: number;
        }
      ).user_version,
    ).toBe(16);
    expect(
      upgradedDb
        .prepare(
          'SELECT document_version, version_state FROM sync_document_versions WHERE deck_id = ?',
        )
        .get('deck-1'),
    ).toMatchObject({ document_version: null, version_state: 'unknown' });
    expect(
      upgradedDb
        .prepare(
          'SELECT deck_id, document_version, version_state FROM sync_annotation_versions WHERE annotation_id = ?',
        )
        .get('note-1'),
    ).toMatchObject({
      deck_id: 'deck-1',
      document_version: null,
      version_state: 'unknown',
    });
    upgradedDb.close();
  });

  it('binds legacy annotations only to the exact cached PDF and supports explicit association', async () => {
    const root = mkdtempSync(join(tmpdir(), 'indicoink-legacy-pdf-'));
    const dbPath = join(root, 'persistence.sqlite3');
    const deckCacheRoot = join(root, 'deck-cache');
    const store = new PersistenceStore(dbPath, () => 1700000000000);
    await store.upsertConference({
      id: 'conference-legacy',
      sourceUrl: 'https://example.org/event',
      title: 'Legacy',
      dates: '',
      host: 'example.org',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertTalk({
      id: 'talk-legacy',
      conferenceId: 'conference-legacy',
      contributionId: '1',
      contributionUrl: 'https://example.org/event/1',
      title: 'Talk',
      speaker: '',
      sessionTitle: '',
      startsAt: null,
      endsAt: null,
      room: '',
      bookmarked: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertDeck({
      id: 'deck-legacy',
      conferenceId: 'conference-legacy',
      talkId: 'talk-legacy',
      sourceUrl: 'https://example.org/slides.pdf',
      displayName: 'Slides',
      mimeType: 'application/pdf',
      selected: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertSlide({
      id: createSlideId('deck-legacy', 1),
      conferenceId: 'conference-legacy',
      talkId: 'talk-legacy',
      deckId: 'deck-legacy',
      slideNumber: 1,
      annotated: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await store.upsertAnnotation({
      id: 'note-legacy',
      conferenceId: 'conference-legacy',
      talkId: 'talk-legacy',
      deckId: 'deck-legacy',
      slideId: createSlideId('deck-legacy', 1),
      x: 0.2,
      y: 0.3,
      text: 'Keep this note',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });

    // Simulate a pre-sync library upgraded by migration 11. The migration
    // seeds the one-time binding marker for existing PDF decks.
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec('DROP TABLE sync_legacy_version_migration;');
    legacyDb.exec('PRAGMA user_version = 10;');
    legacyDb.close();
    await store.close();

    const cachePath = join(
      deckCacheRoot,
      'conference-legacy',
      'deck-legacy.pdf',
    );
    mkdirSync(join(deckCacheRoot, 'conference-legacy'), { recursive: true });
    writeFileSync(cachePath, Buffer.from('%PDF-legacy-original-bytes'));
    const expectedVersion = createHash('sha256')
      .update('%PDF-legacy-original-bytes')
      .digest('hex');

    const upgraded = new PersistenceStore(dbPath, () => 1700000001000);
    await upgraded.bindLegacyDeckDocumentVersion(
      'deck-legacy',
      expectedVersion,
    );
    await expect(
      upgraded.bindLegacyDeckDocumentVersion('deck-legacy', 'b'.repeat(64)),
    ).resolves.toBe(false);
    await expect(upgraded.getAnnotation('note-legacy')).resolves.toMatchObject({
      text: 'Keep this note',
    });
    const boundDb = new DatabaseSync(dbPath, { readOnly: true });
    expect(
      boundDb
        .prepare(
          'SELECT document_version, version_state FROM sync_annotation_versions WHERE annotation_id = ?',
        )
        .get('note-legacy'),
    ).toEqual({ document_version: expectedVersion, version_state: 'known' });
    boundDb.close();

    await upgraded.close();
    const absentPath = createTempDbPath('legacy-unknown');
    const absent = new PersistenceStore(absentPath, () => 1700000002000);
    await absent.upsertConference({
      id: 'conference-absent',
      sourceUrl: 'https://example.org/absent',
      title: 'Absent',
      dates: '',
      host: 'example.org',
      lastOpenedAt: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await absent.upsertTalk({
      id: 'talk-absent',
      conferenceId: 'conference-absent',
      contributionId: '1',
      contributionUrl: 'https://example.org/absent/1',
      title: 'Talk',
      speaker: '',
      sessionTitle: '',
      startsAt: null,
      endsAt: null,
      room: '',
      bookmarked: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await absent.upsertDeck({
      id: 'deck-absent',
      conferenceId: 'conference-absent',
      talkId: 'talk-absent',
      sourceUrl: 'https://example.org/replaced.pdf',
      displayName: 'Slides',
      mimeType: 'application/pdf',
      selected: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await absent.upsertSlide({
      id: createSlideId('deck-absent', 1),
      conferenceId: 'conference-absent',
      talkId: 'talk-absent',
      deckId: 'deck-absent',
      slideNumber: 1,
      annotated: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await absent.upsertAnnotation({
      id: 'note-absent',
      conferenceId: 'conference-absent',
      talkId: 'talk-absent',
      deckId: 'deck-absent',
      slideId: createSlideId('deck-absent', 1),
      x: 0.1,
      y: 0.1,
      text: 'Unbound',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    const absentDb = new DatabaseSync(absentPath);
    absentDb.exec('DROP TABLE sync_legacy_version_migration;');
    absentDb.exec('PRAGMA user_version = 10;');
    absentDb.close();
    await absent.close();
    const reopened = new PersistenceStore(absentPath, () => 1700000003000);
    await reopened.bindLegacyDeckDocumentVersion('deck-absent', null);
    const replacementHash = 'c'.repeat(64);
    await reopened.recordCurrentDeckDocumentVersion(
      'deck-absent',
      replacementHash,
    );
    await reopened.setSyncConfiguration({
      workspaceId: '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d',
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    await reopened.saveDeckPdfWorkspaceChanges({
      sourceUrl: 'https://example.org/replaced.pdf',
      conferenceId: 'conference-absent',
      talkId: 'talk-absent',
      deckId: 'deck-absent',
      pageCount: 1,
      revision: 1,
      changes: [
        {
          kind: 'upsert-text-note',
          pageIndex: 0,
          note: {
            id: 'note-new',
            conferenceId: 'conference-absent',
            talkId: 'talk-absent',
            deckId: 'deck-absent',
            slideId: createSlideId('deck-absent', 1),
            x: 0.2,
            y: 0.2,
            text: 'New bytes',
            createdAt: 1700000003000,
            updatedAt: 1700000003000,
          },
        },
      ],
      history: createWorkspaceHistory(),
      currentSlideNumber: 1,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
    });
    await expect(reopened.getAnnotation('note-absent')).resolves.toMatchObject({
      text: 'Unbound',
    });
    const unknownDb = new DatabaseSync(absentPath, { readOnly: true });
    expect(
      unknownDb
        .prepare(
          'SELECT document_version, version_state FROM sync_annotation_versions WHERE annotation_id = ?',
        )
        .get('note-absent'),
    ).toEqual({ document_version: null, version_state: 'unknown' });
    expect(
      unknownDb
        .prepare(
          'SELECT document_version, version_state FROM sync_annotation_versions WHERE annotation_id = ?',
        )
        .get('note-new'),
    ).toEqual({ document_version: replacementHash, version_state: 'known' });
    unknownDb.close();
    const explicitHash = 'd'.repeat(64);
    await reopened.associateUnknownAnnotationsWithDocumentVersion(
      'deck-absent',
      ['note-absent'],
      explicitHash,
    );
    await reopened.close();
    const restart = new PersistenceStore(absentPath, () => 1700000004000);
    const associatedDb = new DatabaseSync(absentPath, { readOnly: true });
    expect(
      associatedDb
        .prepare(
          'SELECT document_version, version_state FROM sync_annotation_versions WHERE annotation_id = ?',
        )
        .get('note-absent'),
    ).toEqual({ document_version: explicitHash, version_state: 'known' });
    expect(
      associatedDb
        .prepare(
          'SELECT document_version FROM sync_document_versions WHERE deck_id = ?',
        )
        .get('deck-absent'),
    ).toEqual({ document_version: replacementHash });
    associatedDb.close();
    await expect(restart.getAnnotation('note-absent')).resolves.toMatchObject({
      text: 'Unbound',
    });
    await restart.close();
  });

  it('creates a fresh schema and supports repository CRUD and transactions', async () => {
    const dbPath = createTempDbPath('fresh');
    const store = new PersistenceStore(dbPath, () => 1700000000000);

    await expect(store.listConferences()).resolves.toEqual([]);

    await expect(
      store.transaction(async (repo) => {
        await repo.upsertConference({
          id: 'conference-1',
          sourceUrl: 'https://example.org/event',
          title: 'Conference One',
          dates: 'June 1-2, 2026',
          host: 'indico.example.org',
          timeZone: 'Europe/Paris',
          lastOpenedAt: 1700000000000,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        });

        await repo.upsertTalk({
          id: 'talk-1',
          conferenceId: 'conference-1',
          contributionId: 'contribution-1',
          contributionUrl:
            'https://example.org/event/contributions/contribution-1/',
          title: 'Talk One',
          speaker: 'Speaker One',
          sessionTitle: 'Session One',
          startsAt: 1700000001000,
          endsAt: 1700000002000,
          room: 'Room A',
          bookmarked: true,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        });
      }),
    ).resolves.toBeUndefined();

    await expect(store.getConference('conference-1')).resolves.toMatchObject({
      title: 'Conference One',
      timeZone: 'Europe/Paris',
      sourceKind: 'indico',
    });
    await expect(store.getTalk('talk-1')).resolves.toMatchObject({
      bookmarked: true,
    });

    await store.upsertDeck({
      id: 'deck-1',
      conferenceId: 'conference-1',
      talkId: 'talk-1',
      sourceUrl: 'https://example.org/slides.pdf',
      displayName: 'Slides',
      mimeType: 'application/pdf',
      selected: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });

    await store.upsertSlide({
      id: createSlideId('deck-1', 1),
      conferenceId: 'conference-1',
      talkId: 'talk-1',
      deckId: 'deck-1',
      slideNumber: 1,
      annotated: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });

    await store.upsertAnnotation({
      id: 'stroke-1',
      conferenceId: 'conference-1',
      talkId: 'talk-1',
      deckId: 'deck-1',
      slideId: createSlideId('deck-1', 1),
      points: [
        { x: 0.1, y: 0.2, pressure: 0.5, time: 1 },
        { x: 0.2, y: 0.3, pressure: 0.7, time: 2 },
      ],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });

    await store.upsertAnnotation({
      id: 'note-1',
      conferenceId: 'conference-1',
      talkId: 'talk-1',
      deckId: 'deck-1',
      slideId: createSlideId('deck-1', 1),
      x: 0.25,
      y: 0.5,
      width: 0.4,
      text: 'Keep this width',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    await expect(store.getAnnotation('note-1')).resolves.toMatchObject({
      width: 0.4,
      text: 'Keep this width',
    });

    await store.upsertViewState({
      id: 'view-state-1',
      conferenceId: 'conference-1',
      talkId: 'talk-1',
      deckId: 'deck-1',
      slideId: createSlideId('deck-1', 1),
      currentSlideNumber: 1,
      zoom: 1.25,
      scrollLeft: 45,
      scrollTop: 123,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });

    await expect(
      store.listTalksByConference('conference-1'),
    ).resolves.toHaveLength(1);
    await expect(store.listDecksByTalk('talk-1')).resolves.toHaveLength(1);
    await expect(
      store.listDecksByConference('conference-1'),
    ).resolves.toHaveLength(1);
    await expect(store.listSlidesByDeck('deck-1')).resolves.toHaveLength(1);
    await expect(
      store.listSlidesByConference('conference-1'),
    ).resolves.toHaveLength(1);
    await expect(
      store.listAnnotationsBySlide(createSlideId('deck-1', 1)),
    ).resolves.toHaveLength(2);
    await expect(store.countAnnotatedSlidesByTalk('talk-1')).resolves.toBe(1);
    await expect(store.getViewState('deck-1')).resolves.toMatchObject({
      scrollTop: 123,
    });

    await store.deleteConference('conference-1');
    await expect(store.getConference('conference-1')).resolves.toBeNull();
    await expect(store.getTalk('talk-1')).resolves.toBeNull();
    await expect(store.getDeck('deck-1')).resolves.toBeNull();
    await store.close();
  });

  it('upgrades a legacy schema fixture to the current version', async () => {
    const dbPath = createTempDbPath('legacy');
    const SQL = await initSqlJs({
      locateFile: () => getSqlWasmPath(),
    });
    const legacyDb = new SQL.Database();
    legacyDb.exec(`
      PRAGMA user_version = 0;
      CREATE TABLE legacy_marker (id TEXT PRIMARY KEY);
      INSERT INTO legacy_marker (id) VALUES ('legacy-row');
    `);
    writeFileSync(dbPath, legacyDb.export());
    legacyDb.close();

    const store = new PersistenceStore(dbPath, () => 1700000000000);
    await expect(store.listConferences()).resolves.toEqual([]);
    const versionDb = new SQL.Database(new Uint8Array(await readFile(dbPath)));
    const userVersion = versionDb.exec('PRAGMA user_version;');
    expect(userVersion[0]?.values[0]?.[0]).toBe(16);
    versionDb.close();
    expect(existsSync(`${dbPath}.pre-node-sqlite-v7.bak`)).toBe(true);
    const backupDb = new SQL.Database(
      new Uint8Array(await readFile(`${dbPath}.pre-node-sqlite-v7.bak`)),
    );
    expect(
      backupDb.exec('SELECT id FROM legacy_marker;')[0]?.values[0]?.[0],
    ).toBe('legacy-row');
    backupDb.close();
    await store.close();
  });

  it('updates only touched workspace rows and leaves another talk unchanged', async () => {
    const dbPath = createTempDbPath('incremental-isolation');
    const store = new PersistenceStore(dbPath, () => 1700000000000);
    const createSnapshot = (sourceUrl: string, strokeId: string) => ({
      sourceUrl,
      pageCount: 1,
      strokesByPage: [
        [
          {
            id: strokeId,
            pageNumber: 1,
            points: [
              { x: 0.1, y: 0.2, pressure: 0.5, time: 1 },
              { x: 0.2, y: 0.3, pressure: 0.6, time: 2 },
            ],
          },
        ],
      ],
      currentSlideNumber: 1,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
    });

    await store.saveLocalPdfWorkspace(
      createSnapshot('C:\\slides\\talk-a.pdf', 'stroke-a'),
    );
    await store.saveLocalPdfWorkspace(
      createSnapshot('C:\\slides\\talk-b.pdf', 'stroke-b'),
    );

    const inspectBefore = new DatabaseSync(dbPath, { readOnly: true });
    const untouchedBefore = inspectBefore
      .prepare('SELECT payload_json, updated_at FROM annotations WHERE id = ?')
      .get('stroke-b');
    inspectBefore.close();

    await store.saveLocalPdfWorkspaceChanges({
      sourceUrl: 'C:\\slides\\talk-a.pdf',
      pageCount: 1,
      revision: 1,
      changes: [
        {
          kind: 'upsert-stroke',
          pageIndex: 0,
          stroke: {
            id: 'stroke-a-2',
            pageNumber: 1,
            points: [
              { x: 0.3, y: 0.4, pressure: 0.4, time: 3 },
              { x: 0.5, y: 0.6, pressure: 0.8, time: 4 },
            ],
          },
        },
      ],
      history: createWorkspaceHistory(),
      currentSlideNumber: 1,
      scrollLeft: 10,
      scrollTop: 20,
      zoom: 1,
    });

    const inspectAfter = new DatabaseSync(dbPath, { readOnly: true });
    const untouchedAfter = inspectAfter
      .prepare('SELECT payload_json, updated_at FROM annotations WHERE id = ?')
      .get('stroke-b');
    inspectAfter.close();
    expect(untouchedAfter).toEqual(untouchedBefore);
    await expect(
      store.loadLocalPdfWorkspace('C:\\slides\\talk-b.pdf'),
    ).resolves.toMatchObject({
      strokesByPage: [[{ id: 'stroke-b' }]],
    });
    await expect(
      store.loadLocalPdfWorkspace('C:\\slides\\talk-a.pdf'),
    ).resolves.toMatchObject({
      revision: 1,
      strokesByPage: [[{ id: 'stroke-a' }, { id: 'stroke-a-2' }]],
    });

    await store.saveLocalPdfWorkspaceChanges({
      sourceUrl: 'C:\\slides\\talk-a.pdf',
      pageCount: 1,
      revision: 1,
      changes: [
        {
          kind: 'upsert-stroke',
          pageIndex: 0,
          stroke: {
            id: 'stale-stroke',
            pageNumber: 1,
            points: [{ x: 0.9, y: 0.9, pressure: 0.5, time: 9 }],
          },
        },
      ],
      history: createWorkspaceHistory(),
      currentSlideNumber: 1,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
    });
    await expect(
      store.loadLocalPdfWorkspace('C:\\slides\\talk-a.pdf'),
    ).resolves.not.toMatchObject({
      strokesByPage: [expect.arrayContaining([{ id: 'stale-stroke' }])],
    });
    await store.close();
  });

  it('rolls back a failed incremental transaction', async () => {
    const dbPath = createTempDbPath('incremental-rollback');
    const sourceUrl = 'C:\\slides\\rollback.pdf';
    const store = new PersistenceStore(dbPath, () => 1700000000000);
    await store.saveLocalPdfWorkspace({
      sourceUrl,
      pageCount: 1,
      strokesByPage: [[]],
      currentSlideNumber: 1,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
    });

    await expect(
      store.saveLocalPdfWorkspaceChanges({
        sourceUrl,
        pageCount: 1,
        revision: 1,
        changes: [
          {
            kind: 'upsert-stroke',
            pageIndex: 0,
            stroke: {
              id: 'stroke-valid',
              pageNumber: 1,
              points: [{ x: 0.1, y: 0.2, pressure: 0.5, time: 1 }],
            },
          },
          {
            kind: 'upsert-stroke',
            pageIndex: 99,
            stroke: {
              id: 'stroke-invalid',
              pageNumber: 100,
              points: [{ x: 0.2, y: 0.3, pressure: 0.5, time: 2 }],
            },
          },
        ],
        history: createWorkspaceHistory(),
        currentSlideNumber: 1,
        scrollLeft: 0,
        scrollTop: 0,
        zoom: 1,
      }),
    ).rejects.toThrow();

    await expect(store.loadLocalPdfWorkspace(sourceUrl)).resolves.toMatchObject(
      {
        revision: 0,
        strokesByPage: [[]],
      },
    );
    await store.close();
  });

  it('does not invent a timezone when upgrading a version 5 conference', async () => {
    const dbPath = createTempDbPath('legacy-timezone');
    const SQL = await initSqlJs({
      locateFile: () => getSqlWasmPath(),
    });
    const legacyDb = new SQL.Database();
    legacyDb.exec(`
      PRAGMA user_version = 5;
      CREATE TABLE conferences (
        id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        dates TEXT NOT NULL,
        host TEXT NOT NULL,
        last_opened_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO conferences (
        id, source_url, title, dates, host, last_opened_at, created_at, updated_at
      ) VALUES (
        'legacy-conference',
        'https://indico.example.org/event/legacy',
        'Legacy conference',
        'June 12, 2026',
        'indico.example.org',
        1700000000000,
        1700000000000,
        1700000000000
      );
    `);
    writeFileSync(dbPath, legacyDb.export());
    legacyDb.close();

    const store = new PersistenceStore(dbPath, () => 1700000000000);
    await expect(
      store.getConference('legacy-conference'),
    ).resolves.toMatchObject({
      timeZone: null,
      sourceKind: 'indico',
    });
    await store.close();
  });

  it('saves and restores local PDF workspace state across restart', async () => {
    const dbPath = createTempDbPath('workspace');
    const sourceUrl = 'C:\\slides\\deck.pdf';

    const firstStore = new PersistenceStore(dbPath, () => 1700000000000);
    await firstStore.saveLocalPdfWorkspace({
      sourceUrl,
      pageCount: 2,
      strokesByPage: [
        [
          {
            id: 'stroke-1',
            pageNumber: 1,
            baseWidth: 6,
            color: '#ff00aa',
            points: [
              { x: 0.1, y: 0.2, pressure: 0.4, time: 1 },
              { x: 0.3, y: 0.4, pressure: 0.8, time: 2 },
            ],
          },
        ],
        [
          {
            id: 'stroke-2',
            pageNumber: 2,
            points: [
              { x: 0.5, y: 0.6, pressure: 0.2, time: 3 },
              { x: 0.7, y: 0.8, pressure: 0.9, time: 4 },
            ],
          },
        ],
      ],
      textNotesByPage: [
        [],
        [
          {
            id: 'text-note-1',
            conferenceId: 'conference-1',
            talkId: 'talk-1',
            deckId: 'deck-1',
            slideId: createSlideId('deck-1', 2),
            x: 0.4,
            y: 0.6,
            text: 'Speaker note',
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
      ],
      undoStack: [],
      redoStack: [],
      currentSlideNumber: 2,
      scrollLeft: 45,
      scrollTop: 123,
      zoom: 1.25,
    });
    await firstStore.close();

    const secondStore = new PersistenceStore(dbPath, () => 1700000005000);
    const restored = await secondStore.loadLocalPdfWorkspace(sourceUrl);

    expect(restored?.pageCount).toBe(2);
    expect(restored?.strokesByPage[0]).toHaveLength(1);
    expect(restored?.strokesByPage[0]?.[0]?.baseWidth).toBe(6);
    expect(restored?.strokesByPage[0]?.[0]?.color).toBe('#ff00aa');
    expect(restored?.strokesByPage[1]).toHaveLength(1);
    expect(restored?.textNotesByPage?.[1]).toHaveLength(1);
    expect(restored?.scrollLeft).toBe(45);
    expect(restored?.scrollTop).toBe(123);
    expect(restored?.currentSlideNumber).toBe(2);
    expect(restored?.zoom).toBe(1.25);
    await secondStore.close();
  });

  it('restores undo and redo history for a deck workspace across restart', async () => {
    const dbPath = createTempDbPath('workspace-history');
    const now = 1700000000000;

    const firstStore = new PersistenceStore(dbPath, () => now);
    await firstStore.transaction(async (repo) => {
      await repo.upsertConference({
        id: 'conference-history',
        sourceUrl: 'https://example.org/event/history',
        title: 'History Conference',
        dates: 'June 12, 2026',
        host: 'history.example.org',
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await repo.upsertTalk({
        id: 'talk-history',
        conferenceId: 'conference-history',
        contributionId: 'contribution-history',
        contributionUrl:
          'https://example.org/event/history/contributions/contribution-history/',
        title: 'Keeping annotation history',
        speaker: 'Ada Lovelace',
        sessionTitle: 'Persistence session',
        startsAt: now,
        endsAt: now + 1_800_000,
        room: 'Room C',
        bookmarked: false,
        createdAt: now,
        updatedAt: now,
      });
      await repo.upsertDeck({
        id: 'deck-history',
        conferenceId: 'conference-history',
        talkId: 'talk-history',
        sourceUrl: 'https://example.org/materials/history.pdf',
        displayName: 'History deck',
        mimeType: 'application/pdf',
        selected: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const slideId = createSlideId('deck-history', 1);
    await firstStore.saveDeckPdfWorkspace({
      sourceUrl: 'https://example.org/materials/history.pdf',
      conferenceId: 'conference-history',
      talkId: 'talk-history',
      deckId: 'deck-history',
      pageCount: 2,
      strokesByPage: [
        [
          {
            id: 'stroke-current',
            pageNumber: 1,
            points: [
              { x: 0.1, y: 0.2, pressure: 0.3, time: 1 },
              { x: 0.2, y: 0.3, pressure: 0.4, time: 2 },
            ],
          },
        ],
        [],
      ],
      undoStack: [
        [
          {
            strokes: [
              {
                id: 'stroke-undo',
                pageNumber: 1,
                points: [
                  { x: 0.15, y: 0.25, pressure: 0.5, time: 3 },
                  { x: 0.25, y: 0.35, pressure: 0.6, time: 4 },
                ],
              },
            ],
            textNotes: [],
          },
          {
            strokes: [],
            textNotes: [],
          },
        ],
      ],
      redoStack: [
        [
          {
            strokes: [],
            textNotes: [],
          },
          {
            strokes: [
              {
                id: 'stroke-redo',
                pageNumber: 2,
                points: [
                  { x: 0.45, y: 0.55, pressure: 0.2, time: 5 },
                  { x: 0.55, y: 0.65, pressure: 0.8, time: 6 },
                ],
              },
            ],
            textNotes: [],
          },
        ],
      ],
      currentSlideNumber: 1,
      scrollLeft: 11,
      scrollTop: 22,
      zoom: 1.1,
    });
    await firstStore.close();

    const secondStore = new PersistenceStore(dbPath, () => now + 5000);
    const restored = await secondStore.loadDeckPdfWorkspace('deck-history');

    expect(restored?.strokesByPage[0]).toHaveLength(1);
    expect(restored?.strokesByPage[0]?.[0]?.pageNumber).toBe(1);
    expect(restored?.undoStack).toHaveLength(1);
    expect(restored?.undoStack?.[0]?.[0]?.strokes).toHaveLength(1);
    expect(restored?.undoStack?.[0]?.[0]?.strokes[0]?.pageNumber).toBe(1);
    expect(restored?.redoStack).toHaveLength(1);
    expect(restored?.redoStack?.[0]?.[1]?.strokes).toHaveLength(1);
    expect(restored?.redoStack?.[0]?.[1]?.strokes[0]?.pageNumber).toBe(2);
    expect(restored?.currentSlideNumber).toBe(1);
    expect(restored?.zoom).toBe(1.1);
    expect(restored?.deckId).toBe('deck-history');
    await expect(secondStore.getSlide(slideId)).resolves.toMatchObject({
      annotated: true,
    });
    await secondStore.close();
  });

  it('skips malformed annotation payloads while loading a workspace', async () => {
    const dbPath = createTempDbPath('corrupt-workspace');
    const sourceUrl = 'C:\\slides\\corrupt.pdf';

    const firstStore = new PersistenceStore(dbPath, () => 1700000000000);
    await firstStore.saveLocalPdfWorkspace({
      sourceUrl,
      pageCount: 1,
      strokesByPage: [
        [
          {
            id: 'stroke-1',
            pageNumber: 1,
            points: [
              { x: 0.1, y: 0.2, pressure: 0.4, time: 1 },
              { x: 0.3, y: 0.4, pressure: 0.8, time: 2 },
            ],
          },
        ],
      ],
      currentSlideNumber: 1,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
    });
    await firstStore.close();

    const SQL = await initSqlJs({
      locateFile: () => getSqlWasmPath(),
    });
    const corruptedDb = new SQL.Database(
      new Uint8Array(await readFile(dbPath)),
    );
    corruptedDb.exec(
      "UPDATE annotations SET payload_json = 'not-json' WHERE id = 'stroke-1';",
    );
    writeFileSync(dbPath, corruptedDb.export());
    corruptedDb.close();

    const secondStore = new PersistenceStore(dbPath, () => 1700000005000);
    const restored = await secondStore.loadLocalPdfWorkspace(sourceUrl);

    expect(restored?.pageCount).toBe(1);
    expect(restored?.strokesByPage[0]).toHaveLength(0);
    expect(restored?.currentSlideNumber).toBe(1);
    await secondStore.close();
  });

  it('remembers the selected deck for a talk across restart', async () => {
    const dbPath = createTempDbPath('selected-deck');
    const now = 1700000000000;

    const firstStore = new PersistenceStore(dbPath, () => now);
    await firstStore.transaction(async (repo) => {
      await repo.upsertConference({
        id: 'conference-1',
        sourceUrl: 'https://example.org/event/chooser',
        title: 'Chooser Conference',
        dates: 'June 12, 2026',
        host: 'chooser.example.org',
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await repo.upsertTalk({
        id: 'talk-1',
        conferenceId: 'conference-1',
        contributionId: 'contribution-1',
        contributionUrl:
          'https://example.org/event/chooser/contributions/contribution-1/',
        title: 'Choosing the right deck',
        speaker: 'Judy Clapp',
        sessionTitle: 'Tools session',
        startsAt: now,
        endsAt: now + 1_800_000,
        room: 'Auditorium B',
        bookmarked: false,
        createdAt: now,
        updatedAt: now,
      });
      await repo.upsertDeck({
        id: 'deck-a',
        conferenceId: 'conference-1',
        talkId: 'talk-1',
        sourceUrl: 'https://example.org/materials/main.pdf',
        displayName: 'Main deck',
        mimeType: 'application/pdf',
        selected: true,
        createdAt: now,
        updatedAt: now,
      });
      await repo.upsertDeck({
        id: 'deck-b',
        conferenceId: 'conference-1',
        talkId: 'talk-1',
        sourceUrl: 'https://example.org/materials/alt.pdf',
        displayName: 'Alternate deck',
        mimeType: 'application/pdf',
        selected: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    await firstStore.setSelectedDeckForTalk('talk-1', 'deck-b');
    await firstStore.close();

    const secondStore = new PersistenceStore(dbPath, () => now + 5000);
    const decks = await secondStore.listDecksByTalk('talk-1');

    expect(decks).toHaveLength(2);
    expect(decks.find((deck) => deck.id === 'deck-a')?.selected).toBe(false);
    expect(decks.find((deck) => deck.id === 'deck-b')?.selected).toBe(true);

    await expect(secondStore.loadDeckPdfWorkspace('deck-b')).resolves.toEqual(
      expect.objectContaining({
        deckId: 'deck-b',
        conferenceId: 'conference-1',
        talkId: 'talk-1',
        pageCount: 0,
      }),
    );
    await secondStore.close();
  });

  it('orders conferences by most recent access time', async () => {
    const dbPath = createTempDbPath('recent-order');
    const store = new PersistenceStore(dbPath, () => 1_700_000_000_000);

    await store.upsertConference({
      id: 'conference-old',
      sourceUrl: 'https://example.org/event/old',
      title: 'Old Event',
      dates: 'June 1, 2026',
      host: 'old.example.org',
      lastOpenedAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    await store.upsertConference({
      id: 'conference-new',
      sourceUrl: 'https://example.org/event/new',
      title: 'New Event',
      dates: 'June 2, 2026',
      host: 'new.example.org',
      lastOpenedAt: 1_700_000_100_000,
      createdAt: 1_700_000_100_000,
      updatedAt: 1_700_000_100_000,
    });

    await expect(store.listConferences()).resolves.toMatchObject([
      { id: 'conference-new' },
      { id: 'conference-old' },
    ]);

    await store.touchConference('conference-old', 1_700_000_200_000);

    await expect(store.listConferences()).resolves.toMatchObject([
      { id: 'conference-old', lastOpenedAt: 1_700_000_200_000 },
      { id: 'conference-new' },
    ]);
    await store.close();
  });

  it('creates one talk-owned notebook deck and restores its workspace', async () => {
    const dbPath = createTempDbPath('notebook');
    const store = new PersistenceStore(dbPath, () => 1_700_000_000_000);
    await store.upsertConference({
      id: 'conference-notebook',
      sourceUrl: 'https://example.org/event/notebook',
      title: 'Notebook Event',
      dates: 'June 1, 2026',
      host: 'example.org',
      lastOpenedAt: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    await store.upsertTalk({
      id: 'talk-notebook',
      conferenceId: 'conference-notebook',
      contributionId: 'notebook-talk',
      contributionUrl:
        'https://example.org/event/notebook/contributions/notebook-talk',
      title: 'Notebook talk',
      speaker: 'Speaker',
      sessionTitle: 'Session',
      startsAt: null,
      endsAt: null,
      room: 'Room',
      bookmarked: false,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    const first = await store.ensureNotebookDeck('talk-notebook');
    const second = await store.ensureNotebookDeck('talk-notebook');
    expect(first.id).toBe(second.id);
    expect(first.kind).toBe('notebook');
    const workspaceId = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
    await store.setSyncConfiguration({
      workspaceId,
      folderPath: 'C:\\sync-library',
      enabled: true,
    });
    const notebookNote = {
      id: 'note-notebook',
      conferenceId: first.conferenceId,
      talkId: first.talkId,
      deckId: first.id,
      slideId: createSlideId(first.id, 1),
      x: 0.2,
      y: 0.3,
      width: 200,
      text: 'Notebook only',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };

    await store.saveDeckPdfWorkspaceChanges({
      sourceUrl: first.sourceUrl,
      conferenceId: first.conferenceId,
      talkId: first.talkId,
      deckId: first.id,
      pageCount: 1,
      revision: 1,
      changes: [{ kind: 'upsert-text-note', pageIndex: 0, note: notebookNote }],
      history: createWorkspaceHistory(),
      currentSlideNumber: 1,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
    });

    await expect(store.loadDeckPdfWorkspace(first.id)).resolves.toEqual(
      expect.objectContaining({ pageCount: 1, deckId: first.id }),
    );
    await expect(store.listPendingSyncOutbox()).resolves.toEqual([]);
    await store.requeueSyncEligibleAnnotations();
    await store.clearSyncEligibleAnnotations(workspaceId);
    await expect(store.getAnnotation('note-notebook')).resolves.toMatchObject({
      text: 'Notebook only',
    });
    await store.close();
  });
});
