import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLegacySquirrelUninstaller } from './legacySquirrelUninstall';

describe('getLegacySquirrelUninstaller', () => {
  let localAppData: string;

  beforeEach(() => {
    localAppData = mkdtempSync(join(tmpdir(), 'indicoink-squirrel-uninstall-'));
  });

  afterEach(() => {
    rmSync(localAppData, { recursive: true, force: true });
  });

  it('recognizes the old per-user install and rejects an updater on its own', () => {
    const install = join(localAppData, 'indicoink');
    const packages = join(install, 'packages');
    const update = join(install, 'Update.exe');
    mkdirSync(packages, { recursive: true });
    writeFileSync(update, 'fixture');
    expect(getLegacySquirrelUninstaller(localAppData)).toBeUndefined();
    writeFileSync(join(packages, 'RELEASES'), 'fixture');
    expect(getLegacySquirrelUninstaller(localAppData)).toBe(update);
  });

  it('skips a fresh profile or an invalid install root', () => {
    expect(getLegacySquirrelUninstaller(localAppData)).toBeUndefined();
    expect(getLegacySquirrelUninstaller('relative')).toBeUndefined();
    expect(getLegacySquirrelUninstaller(undefined)).toBeUndefined();
  });
});
