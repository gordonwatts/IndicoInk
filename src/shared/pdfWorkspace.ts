import type { InkStroke } from '../strokeTools';
import type { TextNote } from '../persistenceModels';

export type PdfWorkspacePageState = {
  strokes: InkStroke[];
  textNotes: TextNote[];
};

export type WorkspaceHistoryValue<T> = {
  index: number;
  value: T;
};

export type WorkspaceHistoryChange =
  | {
      kind: 'stroke';
      pageIndex: number;
      annotationId: string;
      before: WorkspaceHistoryValue<InkStroke> | null;
      after: WorkspaceHistoryValue<InkStroke> | null;
    }
  | {
      kind: 'text-note';
      pageIndex: number;
      annotationId: string;
      before: WorkspaceHistoryValue<TextNote> | null;
      after: WorkspaceHistoryValue<TextNote> | null;
    };

export type WorkspaceHistoryEntry = {
  id: string;
  changes: WorkspaceHistoryChange[];
};

export type PdfWorkspaceHistory = {
  version: 2;
  undo: WorkspaceHistoryEntry[];
  redo: WorkspaceHistoryEntry[];
};

export type PdfWorkspaceSnapshot = {
  sourceUrl: string;
  conferenceId?: string;
  talkId?: string;
  deckId?: string;
  pageCount: number;
  revision?: number;
  strokesByPage: InkStroke[][];
  textNotesByPage?: TextNote[][];
  history?: PdfWorkspaceHistory;
  /** Legacy V1 snapshot history, read only for migration. */
  undoStack?: PdfWorkspacePageState[][];
  /** Legacy V1 snapshot history, read only for migration. */
  redoStack?: PdfWorkspacePageState[][];
  currentSlideNumber: number;
  scrollLeft: number;
  scrollTop: number;
  zoom: number;
};

export type NotebookWorkspaceSnapshot = PdfWorkspaceSnapshot & {
  kind: 'notebook';
};

export type PdfWorkspaceSaveResult = {
  sourceUrl: string;
  pageCount: number;
  savedAt: number;
};

export type WorkspaceAnnotationChange =
  | {
      kind: 'upsert-stroke';
      pageIndex: number;
      stroke: InkStroke;
    }
  | {
      kind: 'upsert-text-note';
      pageIndex: number;
      note: TextNote;
    }
  | {
      kind: 'delete';
      pageIndex: number;
      annotationId: string;
    };

export type PdfWorkspaceChangeBatch = {
  sourceUrl: string;
  conferenceId?: string;
  talkId?: string;
  deckId?: string;
  pageCount: number;
  revision: number;
  changes: WorkspaceAnnotationChange[];
  history: PdfWorkspaceHistory;
  currentSlideNumber: number;
  scrollLeft: number;
  scrollTop: number;
  zoom: number;
};

export type PdfWorkspaceChangeSaveResult = PdfWorkspaceSaveResult & {
  revision: number;
  transactionDurationMs?: number;
};
