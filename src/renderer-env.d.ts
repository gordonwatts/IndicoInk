import type { AppInfo } from './shared/appInfo';
import type { PdfSelection } from './openPdf';
import type { LibraryEventSummary } from './shared/library';
import type {
  PdfWorkspaceSaveResult,
  PdfWorkspaceSnapshot,
} from './shared/pdfWorkspace';

declare global {
  interface Window {
    indicoInk: {
      getAppInfo: () => Promise<AppInfo>;
      openPdf: () => Promise<PdfSelection>;
      readPdfBytes: (filePath: string) => Promise<Uint8Array>;
      loadPdfWorkspaceState: (
        sourceUrl: string,
      ) => Promise<PdfWorkspaceSnapshot | null>;
      savePdfWorkspaceState: (
        snapshot: PdfWorkspaceSnapshot,
      ) => Promise<PdfWorkspaceSaveResult>;
      listLibraryEvents: () => Promise<LibraryEventSummary[]>;
      deleteLibraryEvent: (conferenceId: string) => Promise<void>;
    };
  }
}

export {};
