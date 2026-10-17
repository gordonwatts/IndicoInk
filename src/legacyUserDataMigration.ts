import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const migrationMarkerName = 'squirrel-user-data-migrated.json';
const migratedEntries = [
  'indicoink-persistence.sqlite3',
  'indicoink-persistence.sqlite3-wal',
  'indicoink-persistence.sqlite3-shm',
  'indicoink-settings.json',
  'indicoink-credentials.json',
  'deck-cache',
] as const;

export type LegacyUserDataMigrationResult = {
  status: 'skipped' | 'migrated' | 'already-migrated' | 'failed';
  copiedEntries: string[];
  error?: string;
};

const copyMissingFiles = (
  sourcePath: string,
  destinationPath: string,
  copiedEntries: string[],
) => {
  const sourceStat = statSync(sourcePath);
  if (sourceStat.isDirectory()) {
    mkdirSync(destinationPath, { recursive: true });
    for (const entry of readdirSync(sourcePath)) {
      copyMissingFiles(
        join(sourcePath, entry),
        join(destinationPath, entry),
        copiedEntries,
      );
    }
    return;
  }

  if (existsSync(destinationPath)) return;
  mkdirSync(dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath, { errorOnExist: true, force: false });
  copiedEntries.push(destinationPath);
};

/**
 * Copies local work from the per-user Electron/Squirrel profile on the first
 * MSIX launch. Existing destination files always win, so a later launch can
 * never overwrite data already created in the MSIX profile.
 */
export const migrateLegacySquirrelUserData = (
  legacyAppDataPath: string | undefined,
  destinationPath: string,
): LegacyUserDataMigrationResult => {
  if (!legacyAppDataPath?.trim()) {
    return { status: 'skipped', copiedEntries: [] };
  }

  const sourceRoot = resolve(legacyAppDataPath);
  const destinationRoot = resolve(destinationPath);
  if (sourceRoot.toLocaleLowerCase() === destinationRoot.toLocaleLowerCase()) {
    return { status: 'skipped', copiedEntries: [] };
  }

  const markerPath = join(destinationRoot, migrationMarkerName);
  if (existsSync(markerPath)) {
    return { status: 'already-migrated', copiedEntries: [] };
  }

  const legacyRoot = join(sourceRoot, 'IndicoInk');
  if (!existsSync(legacyRoot)) {
    return { status: 'skipped', copiedEntries: [] };
  }

  const copiedEntries: string[] = [];
  try {
    mkdirSync(destinationRoot, { recursive: true });
    for (const entry of migratedEntries) {
      const sourcePath = join(legacyRoot, entry);
      if (!existsSync(sourcePath)) continue;
      const destinationEntryPath = join(destinationRoot, entry);
      if (existsSync(destinationEntryPath)) {
        if (
          statSync(sourcePath).isDirectory() &&
          statSync(destinationEntryPath).isDirectory()
        ) {
          copyMissingFiles(sourcePath, destinationEntryPath, copiedEntries);
        }
        continue;
      }
      copyMissingFiles(sourcePath, destinationEntryPath, copiedEntries);
    }

    writeFileSync(
      markerPath,
      `${JSON.stringify({ completedAt: new Date().toISOString() }, null, 2)}\n`,
      { flag: 'wx' },
    );
    return { status: 'migrated', copiedEntries };
  } catch (error) {
    return {
      status: 'failed',
      copiedEntries,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
