import type { AppInfo } from './shared/appInfo';
import type { AgendaTalkSummary } from './shared/agenda';
import type { PdfSelection } from './openPdf';
import type {
  LibraryEventSummary,
  OpenLibraryEventResult,
} from './shared/library';
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
      listAgendaTalks: (conferenceId: string) => Promise<AgendaTalkSummary[]>;
      deleteLibraryEvent: (conferenceId: string) => Promise<void>;
      openLibraryEvent: (
        eventUrl: string,
        apiKey?: string,
      ) => Promise<OpenLibraryEventResult>;
      saveIndicoApiKey: (origin: string, apiKey: string) => Promise<void>;
      setTalkBookmarked: (talkId: string, bookmarked: boolean) => Promise<void>;
      openExternalUrl: (url: string) => Promise<void>;
    };
  }
}

export {};
