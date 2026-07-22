export type AgendaDownloadStatus = {
  operationId: string;
  conferenceId: string;
  startedAt: number;
  kind: 'queued' | 'downloading' | 'ready' | 'error' | 'canceled';
  totalTalks: number;
  totalDecks: number;
  completedDecks: number;
  failedDecks: number;
  downloadedTalks: number;
  currentDeckTitle: string | null;
  message: string | null;
  updatedAt: number;
};

export type AgendaDownloadStartResult = {
  operationId: string;
  conferenceId: string;
};

export type AgendaDownloadSummary = {
  downloadedTalks: number;
  totalTalks: number;
};
