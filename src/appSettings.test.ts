import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  coerceAppSettings,
  loadAppSettings,
  saveAppSettings,
} from './appSettings';
import { DEFAULT_PEN_COLORS } from './shared/appSettings';

describe('appSettings', () => {
  it('uses the default settings when nothing has been saved yet', () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'indicoink-settings-'));

    expect(loadAppSettings(userDataDir)).toEqual({
      recordLogging: false,
      penThickness: 2,
      penColors: [...DEFAULT_PEN_COLORS],
      openAiBaseUrl: 'https://api.openai.com/v1',
      openAiModel: 'gpt-5.6-sol',
      openAiReasoningEffort: 'medium',
    });
  });

  it('round-trips the logging setting through disk', () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'indicoink-settings-'));

    saveAppSettings(userDataDir, {
      recordLogging: true,
      penThickness: 6,
      penColors: [
        '#000000',
        '#ff0000',
        '#00ff00',
        '#0000ff',
        '#ffff00',
        '#ffffff',
      ],
      openAiBaseUrl: 'https://example.test/v1/',
      openAiModel: 'test-model',
      openAiReasoningEffort: 'high',
    });

    expect(
      readFileSync(join(userDataDir, 'indicoink-settings.json'), 'utf8'),
    ).toContain('"recordLogging": true');
    expect(loadAppSettings(userDataDir)).toEqual({
      recordLogging: true,
      penThickness: 6,
      penColors: [
        '#000000',
        '#ff0000',
        '#00ff00',
        '#0000ff',
        '#ffff00',
        '#ffffff',
      ],
      openAiBaseUrl: 'https://example.test/v1',
      openAiModel: 'test-model',
      openAiReasoningEffort: 'high',
    });
  });

  it('normalizes invalid shapes to the default settings', () => {
    expect(
      coerceAppSettings({
        recordLogging: 'yes',
        penThickness: 99,
        penColors: ['#ABCDEF', 'not-a-color'],
      }),
    ).toEqual({
      recordLogging: false,
      penThickness: 8,
      penColors: ['#abcdef', ...DEFAULT_PEN_COLORS.slice(1)],
      openAiBaseUrl: 'https://api.openai.com/v1',
      openAiModel: 'gpt-5.6-sol',
      openAiReasoningEffort: 'medium',
    });
    expect(coerceAppSettings(null)).toEqual({
      recordLogging: false,
      penThickness: 2,
      penColors: [...DEFAULT_PEN_COLORS],
      openAiBaseUrl: 'https://api.openai.com/v1',
      openAiModel: 'gpt-5.6-sol',
      openAiReasoningEffort: 'medium',
    });
  });
});
