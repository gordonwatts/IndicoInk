export type DeckCacheOpenReadyResult = {
  kind: 'ready';
  conferenceId: string;
  talkId: string;
  deckId: string;
  sourceUrl: string;
  displayName: string;
  filePath: string;
  pageCount: number;
};

export type DeckCacheOpenDownloadingResult = {
  kind: 'downloading';
  conferenceId: string;
  talkId: string;
  deckId: string;
  sourceUrl: string;
  displayName: string;
  filePath: string;
  pageCount: number;
  operationId: string;
};

export type DeckCacheOpenErrorResult = {
  kind: 'error';
  conferenceId: string;
  talkId: string;
  deckId: string;
  sourceUrl: string;
  displayName: string;
  filePath: string;
  pageCount: number;
  operationId: string | null;
  message: string;
};

export type DeckCacheOpenApiKeyRequiredResult = {
  kind: 'api-key-required';
  conferenceId: string;
  talkId: string;
  deckId: string;
  sourceUrl: string;
  displayName: string;
  filePath: string;
  pageCount: number;
  operationId: null;
  origin: string;
  message: string;
};

export type DeckCacheOpenResult =
  | DeckCacheOpenReadyResult
  | DeckCacheOpenDownloadingResult
  | DeckCacheOpenErrorResult
  | DeckCacheOpenApiKeyRequiredResult;

export type DeckCacheDownloadStatus = {
  operationId: string;
  conferenceId: string;
  talkId: string;
  deckId: string;
  sourceUrl: string;
  displayName: string;
  filePath: string;
  startedAt: number;
  kind: 'queued' | 'downloading' | 'ready' | 'error' | 'canceled';
  bytesDownloaded: number;
  totalBytes: number | null;
  message: string | null;
  updatedAt: number;
};

export type DeckCacheEnsureResult =
  | { kind: 'ready'; restored: boolean; filePath: string }
  | { kind: 'api-key-required'; message: string; filePath: string }
  | { kind: 'error'; message: string; filePath: string };
