import type { InkStroke } from '../strokeTools';

export type PdfWorkspaceSnapshot = {
  sourceUrl: string;
  conferenceId?: string;
  talkId?: string;
  deckId?: string;
  pageCount: number;
  strokesByPage: InkStroke[][];
  currentSlideNumber: number;
  scrollLeft: number;
  scrollTop: number;
  zoom: number;
};

export type PdfWorkspaceSaveResult = {
  sourceUrl: string;
  pageCount: number;
  savedAt: number;
};
