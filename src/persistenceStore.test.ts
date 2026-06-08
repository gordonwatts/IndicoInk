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
    expect(userVersion[0]?.values[0]?.[0]).toBe(1);
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
    expect(restored?.scrollLeft).toBe(45);
    expect(restored?.scrollTop).toBe(123);
    expect(restored?.currentSlideNumber).toBe(2);
    expect(restored?.zoom).toBe(1.25);
    await secondStore.close();
  });
});
