export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_DEFAULT_MODEL = 'gpt-5.6-sol';

export const OPENAI_REASONING_EFFORTS = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type OpenAiReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

export type OpenAiConfiguration = {
  baseUrl: string;
  model: string;
  reasoningEffort: OpenAiReasoningEffort;
};

export type OpenAiConfigurationInput = OpenAiConfiguration & {
  apiKey: string;
};

export type OpenAiConfigurationSummary = OpenAiConfiguration & {
  hasApiKey: boolean;
  apiKeyUpdatedAt: number | null;
};
