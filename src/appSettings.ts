import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppSettings } from './shared/appSettings';

const appSettingsFileName = 'indicoink-settings.json';

export const defaultAppSettings: AppSettings = {
  recordLogging: false,
};

const normalizeAppSettings = (value: unknown): AppSettings => {
  if (!value || typeof value !== 'object') {
    return defaultAppSettings;
  }

  const { recordLogging } = value as { recordLogging?: unknown };

  return {
    recordLogging: recordLogging === true,
  };
};

export const getAppSettingsPath = (userDataDir: string) =>
  join(userDataDir, appSettingsFileName);

export const loadAppSettings = (userDataDir: string): AppSettings => {
  const settingsPath = getAppSettingsPath(userDataDir);
  if (!existsSync(settingsPath)) {
    return defaultAppSettings;
  }

  try {
    const rawSettings = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
    return normalizeAppSettings(rawSettings);
  } catch {
    return defaultAppSettings;
  }
};

export const saveAppSettings = (
  userDataDir: string,
  settings: AppSettings,
): void => {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(
    getAppSettingsPath(userDataDir),
    `${JSON.stringify({
      recordLogging: settings.recordLogging,
    }, null, 2)}\n`,
    'utf8',
  );
};

export const coerceAppSettings = (value: unknown): AppSettings =>
  normalizeAppSettings(value);

