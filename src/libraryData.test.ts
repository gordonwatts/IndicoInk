import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { conferenceFixtures } from './conferenceFixtures';
import {
  createConferenceId,
  createDeckId,
  createTalkId,
} from './persistenceModels';
import { PersistenceStore } from './persistenceStore';
import {
  buildLibraryEventSummaries,
  importConferenceFixtureByName,
} from './libraryData';

const createTempDbPath = (name: string) =>
  join(mkdtempSync(join(tmpdir(), 'indicoink-library-')), `${name}.sqlite3`);

describe('library data', () => {
  it('imports a fixture conference and exposes it after restart', async () => {
    const dbPath = createTempDbPath('import');
    const firstStore = new PersistenceStore(dbPath, () => 1_700_000_000_000);
    const deckCacheRoot = mkdtempSync(join(tmpdir(), 'indicoink-cache-'));
    const conferenceId = createConferenceId(conferenceFixtures.small.sourceUrl);
    const talkId = createTalkId(conferenceId, 'small-1001');
    const deckId = createDeckId(
      talkId,
      'https://small.indico.example.org/event/indicoink-small-2026/materials/small-1001-slides.pdf',
    );

    const result = await importConferenceFixtureByName(
      firstStore,
      'small',
      1_700_000_000_000,
      deckCacheRoot,
    );
    expect(result.title).toBe(conferenceFixtures.small.title);
    await firstStore.close();

    const secondStore = new PersistenceStore(dbPath, () => 1_700_000_500_000);
    const summaries = await buildLibraryEventSummaries(
      secondStore,
      1_700_000_500_000,
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      title: conferenceFixtures.small.title,
      dates: conferenceFixtures.small.dates,
      host: conferenceFixtures.small.host,
      annotationSummary: '6 annotated slides',
      cacheStatus: 'Cached for offline use',
    });
    expect(summaries[0]?.lastOpened).toContain('Opened');
    const cachedDeckPath = join(deckCacheRoot, conferenceId, `${deckId}.pdf`);
    expect(existsSync(cachedDeckPath)).toBe(true);
    expect(readFileSync(cachedDeckPath, 'utf8')).toContain('%PDF-1.4');
    await secondStore.close();
  });
});
