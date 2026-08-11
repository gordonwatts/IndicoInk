import type { OpenAiReasoningEffort } from './openAi';

export interface AppSettings {
  recordLogging: boolean;
  penThickness: number;
  openAiBaseUrl: string;
  openAiModel: string;
  openAiReasoningEffort: OpenAiReasoningEffort;
}
