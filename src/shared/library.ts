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

export type RefreshConflict = {
  talkId: string;
  contributionId: string;
  talkTitle: string;
  selectedDeckId: string | null;
  selectedDeckTitle: string | null;
  message: string;
};

export type RefreshLibraryEventResult =
  | {
      kind: 'refreshed';
      conferenceId: string;
      title: string;
      talkCount: number;
      deckCount: number;
      changedTalkCount: number;
      removedTalkCount: number;
      newlyAvailableDeckCount: number;
    }
  | {
      kind: 'conflict';
      conferenceId: string;
      title: string;
      conflicts: RefreshConflict[];
    };
