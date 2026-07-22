export type AgendaDownloadStatus = {
  operationId: string;
  conferenceId: string;
  startedAt: number;
  kind: 'queued' | 'downloading' | 'ready' | 'error' | 'canceled';
  totalDecks: number;
  completedDecks: number;
  failedDecks: number;
  currentDeckTitle: string | null;
  message: string | null;
  updatedAt: number;
};

export type AgendaDownloadStartResult = {
  operationId: string;
  conferenceId: string;
};
