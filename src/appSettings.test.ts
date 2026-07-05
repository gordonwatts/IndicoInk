import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  coerceAppSettings,
  loadAppSettings,
  saveAppSettings,
} from './appSettings';

describe('appSettings', () => {
  it('uses the default settings when nothing has been saved yet', () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'indicoink-settings-'));

    expect(loadAppSettings(userDataDir)).toEqual({ recordLogging: false });
  });

  it('round-trips the logging setting through disk', () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'indicoink-settings-'));

    saveAppSettings(userDataDir, { recordLogging: true });

    expect(readFileSync(join(userDataDir, 'indicoink-settings.json'), 'utf8')).toContain(
      '"recordLogging": true',
    );
    expect(loadAppSettings(userDataDir)).toEqual({ recordLogging: true });
  });

  it('normalizes invalid shapes to the default settings', () => {
    expect(coerceAppSettings({ recordLogging: 'yes' })).toEqual({
      recordLogging: false,
    });
    expect(coerceAppSettings(null)).toEqual({ recordLogging: false });
  });
});

