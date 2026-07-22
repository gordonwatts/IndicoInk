import type { AppInfo } from './shared/appInfo';
import type { AppSettings } from './shared/appSettings';
import type { AgendaTalkSummary } from './shared/agenda';
import type {
  AgendaDownloadStartResult,
  AgendaDownloadSummary,
  AgendaDownloadStatus,
} from './shared/agendaDownload';
import type { PdfSelection } from './openPdf';
import type {
  LibraryEventSummary,
  OpenLibraryEventResult,
} from './shared/library';
import type {
  PdfWorkspaceSaveResult,
  PdfWorkspaceSnapshot,
} from './shared/pdfWorkspace';
import type {
  DeckCacheDownloadStatus,
  DeckCacheOpenResult,
} from './shared/deckCache';
import type { ConferenceExportSnapshot } from './shared/exportNotes';
import type { IndicoApiKeySummary } from './shared/indicoCredentials';

declare global {
  interface Window {
    indicoInk: {
      getAppInfo: () => Promise<AppInfo>;
      getDataFolder: () => Promise<string>;
      getAppSettings: () => Promise<AppSettings>;
      getStartupIndicoEventUrl: () => Promise<string | null>;
      openPdf: () => Promise<PdfSelection>;
      readPdfBytes: (filePath: string) => Promise<Uint8Array>;
      loadPdfWorkspaceState: (
        sourceUrl: string,
      ) => Promise<PdfWorkspaceSnapshot | null>;
      savePdfWorkspaceState: (
        snapshot: PdfWorkspaceSnapshot,
      ) => Promise<PdfWorkspaceSaveResult>;
      loadDeckWorkspaceState: (
        deckId: string,
      ) => Promise<PdfWorkspaceSnapshot | null>;
      saveDeckWorkspaceState: (
        snapshot: PdfWorkspaceSnapshot,
      ) => Promise<PdfWorkspaceSaveResult>;
      listLibraryEvents: () => Promise<LibraryEventSummary[]>;
      listAgendaTalks: (conferenceId: string) => Promise<AgendaTalkSummary[]>;
      startAgendaDownload: (
        conferenceId: string,
      ) => Promise<AgendaDownloadStartResult>;
      getAgendaDownloadStatus: (
        operationId: string,
      ) => Promise<AgendaDownloadStatus | null>;
      getAgendaDownloadSummary: (
        conferenceId: string,
      ) => Promise<AgendaDownloadSummary>;
      cancelAgendaDownload: (operationId: string) => Promise<void>;
      deleteLibraryEvent: (conferenceId: string) => Promise<void>;
      refreshLibraryEvent: (
        eventUrl: string,
        decision?: 'keep' | 'replace',
      ) => Promise<import('./shared/library').RefreshLibraryEventResult>;
      openLibraryEvent: (
        eventUrl: string,
        apiKey?: string,
      ) => Promise<OpenLibraryEventResult>;
      resolveLinkedAgendaUrl: (sessionUrl: string) => Promise<string | null>;
      saveIndicoApiKey: (origin: string, apiKey: string) => Promise<void>;
      listIndicoApiKeys: () => Promise<IndicoApiKeySummary[]>;
      deleteIndicoApiKey: (origin: string) => Promise<void>;
      setTalkBookmarked: (talkId: string, bookmarked: boolean) => Promise<void>;
      setSelectedDeck: (talkId: string, deckId: string) => Promise<void>;
      openTalkDeck: (
        conferenceId: string,
        talkId: string,
        deckId: string,
      ) => Promise<DeckCacheOpenResult>;
      getDeckDownloadStatus: (
        operationId: string,
      ) => Promise<DeckCacheDownloadStatus | null>;
      cancelDeckDownload: (operationId: string) => Promise<void>;
      openExternalUrl: (url: string) => Promise<void>;
      openDataFolder: () => Promise<void>;
      getConferenceExportSnapshot: (
        conferenceId: string,
      ) => Promise<ConferenceExportSnapshot | null>;
      setAppSettings: (settings: AppSettings) => Promise<AppSettings>;
      showExportSaveDialog: (options: {
        defaultPath: string;
        title: string;
      }) => Promise<{ canceled: boolean; filePath: string | null }>;
      writeExportFile: (filePath: string, contents: string) => Promise<void>;
      openExportFileLocation: (filePath: string) => Promise<void>;
    };
  }
}

export {};
