export type LibraryEventSummary = {
  id: string;
  sourceUrl: string;
  title: string;
  dates: string;
  host: string;
  lastOpened: string;
  annotationSummary: string;
  cacheStatus: string;
};

export type ImportedConferenceResult = {
  conferenceId: string;
  title: string;
  talkCount: number;
  deckCount: number;
  savedAt: number;
};

export type OpenLibraryEventSuccess = {
  kind: 'opened';
  result: ImportedConferenceResult;
};

export type OpenLibraryEventApiKeyRequired = {
  kind: 'api-key-required';
  origin: string;
  message: string;
};

export type OpenLibraryEventResult =
  | OpenLibraryEventSuccess
  | OpenLibraryEventApiKeyRequired;
