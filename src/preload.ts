import { contextBridge, ipcRenderer } from 'electron';

import type { AppInfo } from './shared/appInfo';
import type { AppSettings } from './shared/appSettings';
import type { PdfSelection } from './openPdf';
import type { RefreshLibraryEventResult } from './shared/library';
import type {
  PdfWorkspaceChangeBatch,
  PdfWorkspaceChangeSaveResult,
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
import type {
  AgendaDownloadStartResult,
  AgendaDownloadSummary,
  AgendaDownloadStatus,
} from './shared/agendaDownload';
import type { ConferenceExportSnapshot } from './shared/exportNotes';
import type { IndicoApiKeySummary } from './shared/indicoCredentials';
import type { Deck } from './persistenceModels';
import type {
  OpenAiConfigurationInput,
  OpenAiConfigurationSummary,
} from './shared/openAi';

const getAppInfo = async (): Promise<AppInfo> =>
  ipcRenderer.invoke('app:get-info');

const getDataFolder = async (): Promise<string> =>
  ipcRenderer.invoke('app:get-data-folder');

const getAppSettings = async (): Promise<AppSettings> =>
  ipcRenderer.invoke('app:get-settings');

const setAppSettings = async (settings: AppSettings): Promise<AppSettings> =>
  ipcRenderer.invoke('app:set-settings', settings);

let startupIndicoEventUrlPromise: Promise<string | null> | null = null;
const getStartupIndicoEventUrl = (): Promise<string | null> => {
  startupIndicoEventUrlPromise ??= ipcRenderer.invoke(
    'app:get-startup-indico-url',
  );
  return startupIndicoEventUrlPromise;
};

const onIndicoEventUrlRequested = (listener: (eventUrl: string) => void) => {
  const handleRequest = (_event: Electron.IpcRendererEvent, eventUrl: string) =>
    listener(eventUrl);
  ipcRenderer.on('app:open-indico-event-url', handleRequest);
  return () =>
    ipcRenderer.removeListener('app:open-indico-event-url', handleRequest);
};

const openPdf = async (): Promise<PdfSelection> =>
  ipcRenderer.invoke('pdf:open');

const readPdfBytes = async (filePath: string): Promise<Uint8Array> =>
  ipcRenderer.invoke('pdf:read', filePath);

const loadPdfWorkspaceState = async (
  sourceUrl: string,
): Promise<PdfWorkspaceSnapshot | null> =>
  ipcRenderer.invoke('persistence:load-pdf-workspace', sourceUrl);

const savePdfWorkspaceChanges = async (
  batch: PdfWorkspaceChangeBatch,
): Promise<PdfWorkspaceChangeSaveResult> =>
  ipcRenderer.invoke('persistence:save-pdf-workspace-changes', batch);

const loadDeckWorkspaceState = async (
  deckId: string,
): Promise<PdfWorkspaceSnapshot | null> =>
  ipcRenderer.invoke('persistence:load-deck-workspace', deckId);

const ensureNotebookDeck = async (talkId: string): Promise<Deck> =>
  ipcRenderer.invoke('persistence:ensure-notebook-deck', talkId);

const saveDeckWorkspaceChanges = async (
  batch: PdfWorkspaceChangeBatch,
): Promise<PdfWorkspaceChangeSaveResult> =>
  ipcRenderer.invoke('persistence:save-deck-workspace-changes', batch);

const listLibraryEvents = async (): Promise<LibraryEventSummary[]> =>
  ipcRenderer.invoke('library:list-events');

const listAgendaTalks = async (
  conferenceId: string,
): Promise<AgendaTalkSummary[]> =>
  ipcRenderer.invoke('agenda:list-talks', conferenceId);

const startAgendaDownload = async (
  conferenceId: string,
): Promise<AgendaDownloadStartResult> =>
  ipcRenderer.invoke('agenda:download-start', conferenceId);

const getAgendaDownloadStatus = async (
  operationId: string,
): Promise<AgendaDownloadStatus | null> =>
  ipcRenderer.invoke('agenda:download-status', operationId);

const getAgendaDownloadSummary = async (
  conferenceId: string,
): Promise<AgendaDownloadSummary> =>
  ipcRenderer.invoke('agenda:download-summary', conferenceId);

const cancelAgendaDownload = async (operationId: string): Promise<void> =>
  ipcRenderer.invoke('agenda:download-cancel', operationId);

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

const resolveLinkedAgendaUrl = async (
  sessionUrl: string,
): Promise<string | null> =>
  ipcRenderer.invoke('agenda:resolve-linked-agenda', sessionUrl);

const saveIndicoApiKey = async (
  origin: string,
  apiKey: string,
): Promise<void> => ipcRenderer.invoke('indico:save-api-key', origin, apiKey);

const listIndicoApiKeys = async (): Promise<IndicoApiKeySummary[]> =>
  ipcRenderer.invoke('indico:list-api-keys');

const deleteIndicoApiKey = async (origin: string): Promise<void> =>
  ipcRenderer.invoke('indico:delete-api-key', origin);

const getOpenAiConfiguration = async (): Promise<OpenAiConfigurationSummary> =>
  ipcRenderer.invoke('openai:get-configuration');

const saveOpenAiConfiguration = async (
  input: OpenAiConfigurationInput,
): Promise<OpenAiConfigurationSummary> =>
  ipcRenderer.invoke('openai:save-configuration', input);

const deleteOpenAiApiKey = async (): Promise<void> =>
  ipcRenderer.invoke('openai:delete-api-key');

const onAgendaProgress = (
  listener: (progress: {
    operation: 'open' | 'refresh';
    stage:
      | 'fetching-event'
      | 'reading-event'
      | 'parsing-event'
      | 'saving-event'
      | 'fetching-webpage'
      | 'extracting-agenda';
  }) => void,
) => {
  const handleProgress = (
    _event: Electron.IpcRendererEvent,
    progress: {
      operation: 'open' | 'refresh';
      stage:
        | 'fetching-event'
        | 'reading-event'
        | 'parsing-event'
        | 'saving-event'
        | 'fetching-webpage'
        | 'extracting-agenda';
    },
  ) => listener(progress);
  ipcRenderer.on('agenda:progress', handleProgress);
  return () => ipcRenderer.removeListener('agenda:progress', handleProgress);
};

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
  talkId?: string | null,
): Promise<ConferenceExportSnapshot | null> =>
  ipcRenderer.invoke('export:get-conference-snapshot', conferenceId, talkId);

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
  onIndicoEventUrlRequested,
  openPdf,
  readPdfBytes,
  loadPdfWorkspaceState,
  savePdfWorkspaceChanges,
  loadDeckWorkspaceState,
  ensureNotebookDeck,
  saveDeckWorkspaceChanges,
  listLibraryEvents,
  listAgendaTalks,
  startAgendaDownload,
  getAgendaDownloadStatus,
  getAgendaDownloadSummary,
  cancelAgendaDownload,
  deleteLibraryEvent,
  refreshLibraryEvent,
  openLibraryEvent,
  resolveLinkedAgendaUrl,
  saveIndicoApiKey,
  listIndicoApiKeys,
  deleteIndicoApiKey,
  getOpenAiConfiguration,
  saveOpenAiConfiguration,
  deleteOpenAiApiKey,
  onAgendaProgress,
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
  onIndicoEventUrlRequested: (
    listener: (eventUrl: string) => void,
  ) => () => void;
  openPdf: () => Promise<PdfSelection>;
  readPdfBytes: (filePath: string) => Promise<Uint8Array>;
  loadPdfWorkspaceState: (
    sourceUrl: string,
  ) => Promise<PdfWorkspaceSnapshot | null>;
  savePdfWorkspaceChanges: (
    batch: PdfWorkspaceChangeBatch,
  ) => Promise<PdfWorkspaceChangeSaveResult>;
  loadDeckWorkspaceState: (
    deckId: string,
  ) => Promise<PdfWorkspaceSnapshot | null>;
  ensureNotebookDeck: (talkId: string) => Promise<Deck>;
  saveDeckWorkspaceChanges: (
    batch: PdfWorkspaceChangeBatch,
  ) => Promise<PdfWorkspaceChangeSaveResult>;
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
  ) => Promise<RefreshLibraryEventResult>;
  openLibraryEvent: (
    eventUrl: string,
    apiKey?: string,
  ) => Promise<OpenLibraryEventResult>;
  resolveLinkedAgendaUrl: (sessionUrl: string) => Promise<string | null>;
  saveIndicoApiKey: (origin: string, apiKey: string) => Promise<void>;
  listIndicoApiKeys: () => Promise<IndicoApiKeySummary[]>;
  deleteIndicoApiKey: (origin: string) => Promise<void>;
  getOpenAiConfiguration: () => Promise<OpenAiConfigurationSummary>;
  saveOpenAiConfiguration: (
    input: OpenAiConfigurationInput,
  ) => Promise<OpenAiConfigurationSummary>;
  deleteOpenAiApiKey: () => Promise<void>;
  onAgendaProgress: (
    listener: (progress: {
      operation: 'open' | 'refresh';
      stage:
        | 'fetching-event'
        | 'reading-event'
        | 'parsing-event'
        | 'saving-event'
        | 'fetching-webpage'
        | 'extracting-agenda';
    }) => void,
  ) => () => void;
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
    talkId?: string | null,
  ) => Promise<ConferenceExportSnapshot | null>;
  setAppSettings: (settings: AppSettings) => Promise<AppSettings>;
  showExportSaveDialog: (options: {
    defaultPath: string;
    title: string;
  }) => Promise<{ canceled: boolean; filePath: string | null }>;
  writeExportFile: (filePath: string, contents: string) => Promise<void>;
  openExportFileLocation: (filePath: string) => Promise<void>;
};
