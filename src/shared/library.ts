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
