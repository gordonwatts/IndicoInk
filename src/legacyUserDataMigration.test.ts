import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateLegacySquirrelUserData } from './legacyUserDataMigration';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = () => {
  const path = mkdtempSync(join(tmpdir(), 'indicoink-msix-migration-'));
  temporaryDirectories.push(path);
  return path;
};

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('migrateLegacySquirrelUserData', () => {
  it('copies user data and cached decks from the legacy profile once', () => {
    const appDataRoot = createTemporaryDirectory();
    const legacyRoot = join(appDataRoot, 'IndicoInk');
    const destinationRoot = join(createTemporaryDirectory(), 'PackageData');
    const deckDirectory = join(legacyRoot, 'deck-cache', 'deck-1');
    mkdirSync(deckDirectory, { recursive: true });
    writeFileSync(
      join(legacyRoot, 'indicoink-persistence.sqlite3'),
      'database',
    );
    writeFileSync(
      join(legacyRoot, 'indicoink-settings.json'),
      '{"theme":"dark"}',
    );
    writeFileSync(
      join(legacyRoot, 'indicoink-credentials.json'),
      'credentials',
    );
    writeFileSync(join(deckDirectory, 'slides.pdf'), 'pdf bytes');

    const firstRun = migrateLegacySquirrelUserData(
      appDataRoot,
      destinationRoot,
    );
    const secondRun = migrateLegacySquirrelUserData(
      appDataRoot,
      destinationRoot,
    );

    expect(firstRun.status).toBe('migrated');
    expect(firstRun.copiedEntries).toHaveLength(4);
    expect(secondRun.status).toBe('already-migrated');
    expect(
      readFileSync(join(destinationRoot, 'indicoink-settings.json'), 'utf8'),
    ).toBe('{"theme":"dark"}');
    expect(
      readFileSync(
        join(destinationRoot, 'deck-cache', 'deck-1', 'slides.pdf'),
        'utf8',
      ),
    ).toBe('pdf bytes');
  });

  it('keeps files already present in the destination', () => {
    const appDataRoot = createTemporaryDirectory();
    const legacyRoot = join(appDataRoot, 'IndicoInk');
    const destinationRoot = createTemporaryDirectory();
    mkdirSync(legacyRoot, { recursive: true });
    mkdirSync(join(legacyRoot, 'deck-cache', 'deck-1'), { recursive: true });
    writeFileSync(join(legacyRoot, 'indicoink-settings.json'), 'legacy');
    writeFileSync(
      join(legacyRoot, 'deck-cache', 'deck-1', 'slides.pdf'),
      'legacy pdf',
    );
    writeFileSync(join(destinationRoot, 'indicoink-settings.json'), 'current');
    mkdirSync(join(destinationRoot, 'deck-cache'), { recursive: true });

    const result = migrateLegacySquirrelUserData(appDataRoot, destinationRoot);

    expect(result.status).toBe('migrated');
    expect(result.copiedEntries).toHaveLength(1);
    expect(
      readFileSync(join(destinationRoot, 'indicoink-settings.json'), 'utf8'),
    ).toBe('current');
    expect(
      readFileSync(
        join(destinationRoot, 'deck-cache', 'deck-1', 'slides.pdf'),
        'utf8',
      ),
    ).toBe('legacy pdf');
  });

  it('skips when there is no legacy profile or source path', () => {
    const destinationRoot = createTemporaryDirectory();

    expect(
      migrateLegacySquirrelUserData(undefined, destinationRoot).status,
    ).toBe('skipped');
    expect(
      migrateLegacySquirrelUserData(createTemporaryDirectory(), destinationRoot)
        .status,
    ).toBe('skipped');
  });
});
