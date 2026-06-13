import { mkdtempSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { describe, expect, it } from 'vitest';

import { createSlideId } from './persistenceModels';
import { PersistenceStore } from './persistenceStore';

const createTempDbPath = (name: string) =>
  join(
    mkdtempSync(join(tmpdir(), 'indicoink-persistence-')),
    `${name}.sqlite3`,
  );

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
          lastOpenedAt: 1700000000000,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        });

        await repo.upsertTalk({
          id: 'talk-1',
          conferenceId: 'conference-1',
          contributionId: 'contribution-1',
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
      locateFile: () => sqlWasmUrl,
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
    expect(userVersion[0]?.values[0]?.[0]).toBe(2);
    versionDb.close();
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
      locateFile: () => sqlWasmUrl,
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
});
