import {
  closeSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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

type MigrationOptions = {
  /** Test seam for simulating interrupted or incomplete copies. */
  copyFile?: (sourcePath: string, stagingPath: string) => void;
};

const fileHash = (path: string) => {
  const fd = openSync(path, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
};

const publishFileIfMissing = (
  sourcePath: string,
  destinationPath: string,
  copiedEntries: string[],
  copyFile: (sourcePath: string, stagingPath: string) => void,
) => {
  if (existsSync(destinationPath)) return;

  mkdirSync(dirname(destinationPath), { recursive: true });
  const stagingPath = join(
    dirname(destinationPath),
    `.${randomUUID()}.indicoink-migration-tmp`,
  );
  try {
    const sourceHashBefore = fileHash(sourcePath);
    copyFile(sourcePath, stagingPath);
    const sourceHashAfter = fileHash(sourcePath);
    const stagedHash = fileHash(stagingPath);
    if (sourceHashBefore !== sourceHashAfter || stagedHash !== sourceHashAfter) {
      throw new Error('COPY_VALIDATION_FAILED');
    }

    try {
      // A same-directory hard link publishes the fully written file atomically
      // and fails with EEXIST if another launch already populated the target.
      linkSync(stagingPath, destinationPath);
      copiedEntries.push(destinationPath);
    } catch (error) {
      if (!existsSync(destinationPath)) throw error;
    }
  } finally {
    if (existsSync(stagingPath)) unlinkSync(stagingPath);
  }
};

const copyMissingFiles = (
  sourcePath: string,
  destinationPath: string,
  copiedEntries: string[],
  copyFile: (sourcePath: string, stagingPath: string) => void,
) => {
  if (existsSync(destinationPath)) {
    const sourceStat = statSync(sourcePath);
    const destinationStat = statSync(destinationPath);
    if (!sourceStat.isDirectory() || !destinationStat.isDirectory()) return;
  }

  const sourceStat = statSync(sourcePath);
  if (sourceStat.isDirectory()) {
    mkdirSync(destinationPath, { recursive: true });
    for (const entry of readdirSync(sourcePath)) {
      copyMissingFiles(
        join(sourcePath, entry),
        join(destinationPath, entry),
        copiedEntries,
        copyFile,
      );
    }
    return;
  }

  publishFileIfMissing(sourcePath, destinationPath, copiedEntries, copyFile);
};

const validateEntryMigrated = (
  sourcePath: string,
  destinationPath: string,
): boolean => {
  if (!existsSync(destinationPath)) return false;

  const sourceStat = statSync(sourcePath);
  const destinationStat = statSync(destinationPath);
  // A pre-existing destination of a different kind is still authoritative.
  if (sourceStat.isDirectory() !== destinationStat.isDirectory()) return true;
  if (!sourceStat.isDirectory()) return true;

  return readdirSync(sourcePath).every((entry) =>
    validateEntryMigrated(
      join(sourcePath, entry),
      join(destinationPath, entry),
    ),
  );
};

const publishCompletionMarker = (markerPath: string) => {
  const stagingPath = join(
    dirname(markerPath),
    `.${randomUUID()}.indicoink-migration-marker-tmp`,
  );
  try {
    writeFileSync(
      stagingPath,
      `${JSON.stringify({ completedAt: new Date().toISOString() }, null, 2)}\n`,
      { flag: 'wx' },
    );
    try {
      linkSync(stagingPath, markerPath);
    } catch (error) {
      if (!existsSync(markerPath)) throw error;
    }
  } finally {
    if (existsSync(stagingPath)) unlinkSync(stagingPath);
  }
};

/**
 * Copies local work from the per-user Electron/Squirrel profile on the first
 * MSIX launch. Each file is staged beside its destination and atomically
 * published only after its source and staged bytes validate. Existing
 * destination files always win, and an incomplete pass remains retryable.
 */
export const migrateLegacySquirrelUserData = (
  legacyAppDataPath: string | undefined,
  destinationPath: string,
  options: MigrationOptions = {},
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
    const copyFile = options.copyFile ?? copyFileSync;
    for (const entry of migratedEntries) {
      const sourcePath = join(legacyRoot, entry);
      if (!existsSync(sourcePath)) continue;
      copyMissingFiles(
        sourcePath,
        join(destinationRoot, entry),
        copiedEntries,
        copyFile,
      );
    }

    const allEntriesValidated = migratedEntries.every((entry) => {
      const sourcePath = join(legacyRoot, entry);
      return (
        !existsSync(sourcePath) ||
        validateEntryMigrated(sourcePath, join(destinationRoot, entry))
      );
    });
    if (!allEntriesValidated) throw new Error('MIGRATION_VALIDATION_FAILED');

    publishCompletionMarker(markerPath);
    return { status: 'migrated', copiedEntries };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : error instanceof Error &&
            ['COPY_VALIDATION_FAILED', 'MIGRATION_VALIDATION_FAILED'].includes(
              error.message,
            )
          ? error.message
          : 'MIGRATION_FAILED';
    return { status: 'failed', copiedEntries, error: code };
  }
};
