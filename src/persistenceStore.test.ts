import { existsSync, mkdtempSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { describe, expect, it } from 'vitest';

import { createSlideId } from './persistenceModels';
import { PersistenceStore } from './persistenceStore';
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
    await expect(store.listSlidesByDeck('deck-1')).resolves.toHaveLength(1);
    await expect(
      store.listAnnotationsBySlide(createSlideId('deck-1', 1)),
    ).resolves.toHaveLength(1);
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
    expect(userVersion[0]?.values[0]?.[0]).toBe(9);
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

    await store.saveDeckPdfWorkspaceChanges({
      sourceUrl: first.sourceUrl,
      conferenceId: first.conferenceId,
      talkId: first.talkId,
      deckId: first.id,
      pageCount: 1,
      revision: 1,
      changes: [],
      history: createWorkspaceHistory(),
      currentSlideNumber: 1,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
    });

    await expect(store.loadDeckPdfWorkspace(first.id)).resolves.toEqual(
      expect.objectContaining({ pageCount: 1, deckId: first.id }),
    );
    await store.close();
  });
});
