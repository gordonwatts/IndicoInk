import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppSettings } from './shared/appSettings';
import { DEFAULT_PEN_COLORS, PEN_COLOR_COUNT } from './shared/appSettings';
import {
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  OPENAI_REASONING_EFFORTS,
  type OpenAiReasoningEffort,
} from './shared/openAi';
import {
  DEFAULT_PEN_THICKNESS,
  MAX_PEN_THICKNESS,
  MIN_PEN_THICKNESS,
} from './strokeTools';

const appSettingsFileName = 'indicoink-settings.json';

export const defaultAppSettings: AppSettings = {
  recordLogging: false,
  penThickness: DEFAULT_PEN_THICKNESS,
  penColors: [...DEFAULT_PEN_COLORS],
  openAiBaseUrl: OPENAI_DEFAULT_BASE_URL,
  openAiModel: OPENAI_DEFAULT_MODEL,
  openAiReasoningEffort: 'medium',
};

const normalizeNonEmptyString = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const normalizeOpenAiBaseUrl = (value: unknown) =>
  normalizeNonEmptyString(value, OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '');

const normalizeOpenAiReasoningEffort = (
  value: unknown,
): OpenAiReasoningEffort =>
  typeof value === 'string' &&
  OPENAI_REASONING_EFFORTS.includes(value as OpenAiReasoningEffort)
    ? (value as OpenAiReasoningEffort)
    : 'medium';

const normalizePenThickness = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PEN_THICKNESS;
  }

  return Math.max(MIN_PEN_THICKNESS, Math.min(MAX_PEN_THICKNESS, value));
};

const normalizePenColor = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;

const normalizePenColors = (value: unknown) => {
  const values = Array.isArray(value) ? value : [];
  return Array.from({ length: PEN_COLOR_COUNT }, (_, index) =>
    normalizePenColor(values[index], DEFAULT_PEN_COLORS[index]!),
  );
};

const normalizeAppSettings = (value: unknown): AppSettings => {
  if (!value || typeof value !== 'object') {
    return defaultAppSettings;
  }

  const {
    recordLogging,
    penThickness,
    penColors,
    openAiBaseUrl,
    openAiModel,
    openAiReasoningEffort,
  } = value as {
    recordLogging?: unknown;
    penThickness?: unknown;
    penColors?: unknown;
    openAiBaseUrl?: unknown;
    openAiModel?: unknown;
    openAiReasoningEffort?: unknown;
  };

  return {
    recordLogging: recordLogging === true,
    penThickness: normalizePenThickness(penThickness),
    penColors: normalizePenColors(penColors),
    openAiBaseUrl: normalizeOpenAiBaseUrl(openAiBaseUrl),
    openAiModel: normalizeNonEmptyString(openAiModel, OPENAI_DEFAULT_MODEL),
    openAiReasoningEffort: normalizeOpenAiReasoningEffort(
      openAiReasoningEffort,
    ),
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
        penColors: settings.penColors ?? [...DEFAULT_PEN_COLORS],
        openAiBaseUrl: settings.openAiBaseUrl,
        openAiModel: settings.openAiModel,
        openAiReasoningEffort: settings.openAiReasoningEffort,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
};

export const coerceAppSettings = (value: unknown): AppSettings =>
  normalizeAppSettings(value);
