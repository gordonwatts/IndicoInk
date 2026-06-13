import type { InkStroke } from '../strokeTools';
import type { TextNote } from '../persistenceModels';

export type PdfWorkspacePageState = {
  strokes: InkStroke[];
  textNotes: TextNote[];
};

export type PdfWorkspaceSnapshot = {
  sourceUrl: string;
  conferenceId?: string;
  talkId?: string;
  deckId?: string;
  pageCount: number;
  strokesByPage: InkStroke[][];
  textNotesByPage?: TextNote[][];
  undoStack?: PdfWorkspacePageState[][];
  redoStack?: PdfWorkspacePageState[][];
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
