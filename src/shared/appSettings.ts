import type { OpenAiReasoningEffort } from './openAi';

export const DEFAULT_PEN_COLORS = [
  '#111111',
  '#d13438',
  '#ca5010',
  '#107c10',
  '#0078d4',
  '#ffffff',
] as const;

export const DEFAULT_PEN_COLOR_NAMES = [
  'Black',
  'Red',
  'Orange',
  'Green',
  'Blue',
  'White',
] as const;

export const PEN_COLOR_COUNT = DEFAULT_PEN_COLORS.length;

export interface AppSettings {
  recordLogging: boolean;
  penThickness: number;
  penColors?: string[];
  openAiBaseUrl: string;
  openAiModel: string;
  openAiReasoningEffort: OpenAiReasoningEffort;
}
