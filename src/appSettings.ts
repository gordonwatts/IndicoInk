import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppSettings } from './shared/appSettings';
import {
  DEFAULT_PEN_THICKNESS,
  MAX_PEN_THICKNESS,
  MIN_PEN_THICKNESS,
} from './strokeTools';

const appSettingsFileName = 'indicoink-settings.json';

export const defaultAppSettings: AppSettings = {
  recordLogging: false,
  penThickness: DEFAULT_PEN_THICKNESS,
};

const normalizePenThickness = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PEN_THICKNESS;
  }

  return Math.max(MIN_PEN_THICKNESS, Math.min(MAX_PEN_THICKNESS, value));
};

const normalizeAppSettings = (value: unknown): AppSettings => {
  if (!value || typeof value !== 'object') {
    return defaultAppSettings;
  }

  const { recordLogging, penThickness } = value as {
    recordLogging?: unknown;
    penThickness?: unknown;
  };

  return {
    recordLogging: recordLogging === true,
    penThickness: normalizePenThickness(penThickness),
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
    const rawSettings = JSON.parse(
      readFileSync(settingsPath, 'utf8'),
    ) as unknown;
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
    `${JSON.stringify(
      {
        recordLogging: settings.recordLogging,
        penThickness: settings.penThickness,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
};

export const coerceAppSettings = (value: unknown): AppSettings =>
  normalizeAppSettings(value);
