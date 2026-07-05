import { contextBridge, ipcRenderer } from 'electron';

import type { AppInfo } from './shared/appInfo';
import type { AppSettings } from './shared/appSettings';
import type { PdfSelection } from './openPdf';
import type { RefreshLibraryEventResult } from './shared/library';
import type {
  PdfWorkspaceSaveResult,
  PdfWorkspaceSnapshot,
} from './shared/pdfWorkspace';
import type {
  DeckCacheDownloadStatus,
  DeckCacheOpenResult,
} from './shared/deckCache';
import type {
  LibraryEventSummary,
  OpenLibraryEventResult,
} from './shared/library';
import type { AgendaTalkSummary } from './shared/agenda';
import type { ConferenceExportSnapshot } from './shared/exportNotes';
import type { IndicoApiKeySummary } from './shared/indicoCredentials';

const getAppInfo = async (): Promise<AppInfo> =>
  ipcRenderer.invoke('app:get-info');

const getDataFolder = async (): Promise<string> =>
  ipcRenderer.invoke('app:get-data-folder');

const getAppSettings = async (): Promise<AppSettings> =>
  ipcRenderer.invoke('app:get-settings');

const setAppSettings = async (settings: AppSettings): Promise<AppSettings> =>
  ipcRenderer.invoke('app:set-settings', settings);

const getStartupIndicoEventUrl = async (): Promise<string | null> =>
  ipcRenderer.invoke('app:get-startup-indico-url');

const openPdf = async (): Promise<PdfSelection> =>
  ipcRenderer.invoke('pdf:open');

const readPdfBytes = async (filePath: string): Promise<Uint8Array> =>
  ipcRenderer.invoke('pdf:read', filePath);

const loadPdfWorkspaceState = async (
  sourceUrl: string,
): Promise<PdfWorkspaceSnapshot | null> =>
  ipcRenderer.invoke('persistence:load-pdf-workspace', sourceUrl);

const savePdfWorkspaceState = async (
  snapshot: PdfWorkspaceSnapshot,
): Promise<PdfWorkspaceSaveResult> =>
  ipcRenderer.invoke('persistence:save-pdf-workspace', snapshot);

const loadDeckWorkspaceState = async (
  deckId: string,
): Promise<PdfWorkspaceSnapshot | null> =>
  ipcRenderer.invoke('persistence:load-deck-workspace', deckId);

const saveDeckWorkspaceState = async (
  snapshot: PdfWorkspaceSnapshot,
): Promise<PdfWorkspaceSaveResult> =>
  ipcRenderer.invoke('persistence:save-deck-workspace', snapshot);

const listLibraryEvents = async (): Promise<LibraryEventSummary[]> =>
  ipcRenderer.invoke('library:list-events');

const listAgendaTalks = async (
  conferenceId: string,
): Promise<AgendaTalkSummary[]> =>
  ipcRenderer.invoke('agenda:list-talks', conferenceId);

const deleteLibraryEvent = async (conferenceId: string): Promise<void> =>
  ipcRenderer.invoke('library:delete-event', conferenceId);

const refreshLibraryEvent = async (
  eventUrl: string,
  decision?: 'keep' | 'replace',
): Promise<RefreshLibraryEventResult> =>
  ipcRenderer.invoke('library:refresh-event', eventUrl, decision);

const openLibraryEvent = async (
  eventUrl: string,
  apiKey?: string,
): Promise<OpenLibraryEventResult> =>
  ipcRenderer.invoke('library:open-event', eventUrl, apiKey);

const saveIndicoApiKey = async (
  origin: string,
  apiKey: string,
): Promise<void> => ipcRenderer.invoke('indico:save-api-key', origin, apiKey);

const listIndicoApiKeys = async (): Promise<IndicoApiKeySummary[]> =>
  ipcRenderer.invoke('indico:list-api-keys');

const deleteIndicoApiKey = async (origin: string): Promise<void> =>
  ipcRenderer.invoke('indico:delete-api-key', origin);

const setTalkBookmarked = async (
  talkId: string,
  bookmarked: boolean,
): Promise<void> =>
  ipcRenderer.invoke('agenda:set-talk-bookmarked', talkId, bookmarked);

const setSelectedDeck = async (talkId: string, deckId: string): Promise<void> =>
  ipcRenderer.invoke('agenda:set-selected-deck', talkId, deckId);

const openTalkDeck = async (
  conferenceId: string,
  talkId: string,
  deckId: string,
): Promise<DeckCacheOpenResult> =>
  ipcRenderer.invoke('deck:open', conferenceId, talkId, deckId);

const getDeckDownloadStatus = async (
  operationId: string,
): Promise<DeckCacheDownloadStatus | null> =>
  ipcRenderer.invoke('deck:download-status', operationId);

const cancelDeckDownload = async (operationId: string): Promise<void> =>
  ipcRenderer.invoke('deck:cancel-download', operationId);

const openExternalUrl = async (url: string): Promise<void> =>
  ipcRenderer.invoke('system:open-external-url', url);

const openDataFolder = async (): Promise<void> =>
  ipcRenderer.invoke('system:open-data-folder');

const getConferenceExportSnapshot = async (
  conferenceId: string,
): Promise<ConferenceExportSnapshot | null> =>
  ipcRenderer.invoke('export:get-conference-snapshot', conferenceId);

const showExportSaveDialog = async (options: {
  defaultPath: string;
  title: string;
}): Promise<{ canceled: boolean; filePath: string | null }> =>
  ipcRenderer.invoke('export:show-save-dialog', options);

const writeExportFile = async (
  filePath: string,
  contents: string,
): Promise<void> => ipcRenderer.invoke('export:write-file', filePath, contents);

const openExportFileLocation = async (filePath: string): Promise<void> =>
  ipcRenderer.invoke('export:open-file-location', filePath);

contextBridge.exposeInMainWorld('indicoInk', {
  getAppInfo,
  getDataFolder,
  getAppSettings,
  getStartupIndicoEventUrl,
  openPdf,
  readPdfBytes,
  loadPdfWorkspaceState,
  savePdfWorkspaceState,
  loadDeckWorkspaceState,
  saveDeckWorkspaceState,
  listLibraryEvents,
  listAgendaTalks,
  deleteLibraryEvent,
  refreshLibraryEvent,
  openLibraryEvent,
  saveIndicoApiKey,
  listIndicoApiKeys,
  deleteIndicoApiKey,
  setTalkBookmarked,
  setSelectedDeck,
  openTalkDeck,
  getDeckDownloadStatus,
  cancelDeckDownload,
  openExternalUrl,
  openDataFolder,
  getConferenceExportSnapshot,
  showExportSaveDialog,
  writeExportFile,
  openExportFileLocation,
  setAppSettings,
});

export type IndicoInkApi = {
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
  deleteLibraryEvent: (conferenceId: string) => Promise<void>;
  refreshLibraryEvent: (
    eventUrl: string,
    decision?: 'keep' | 'replace',
  ) => Promise<RefreshLibraryEventResult>;
  openLibraryEvent: (
    eventUrl: string,
    apiKey?: string,
  ) => Promise<OpenLibraryEventResult>;
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
