import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { conferenceFixtures } from './conferenceFixtures';
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

    const result = await importConferenceFixtureByName(
      firstStore,
      'small',
      1_700_000_000_000,
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
    await secondStore.close();
  });
});
