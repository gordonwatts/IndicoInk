import { contextBridge, ipcRenderer } from 'electron';

import type { AppInfo } from './shared/appInfo';
import type { PdfSelection } from './openPdf';
import type {
  PdfWorkspaceSaveResult,
  PdfWorkspaceSnapshot,
} from './shared/pdfWorkspace';
import type { LibraryEventSummary } from './shared/library';

const getAppInfo = async (): Promise<AppInfo> =>
  ipcRenderer.invoke('app:get-info');

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

const listLibraryEvents = async (): Promise<LibraryEventSummary[]> =>
  ipcRenderer.invoke('library:list-events');

const deleteLibraryEvent = async (conferenceId: string): Promise<void> =>
  ipcRenderer.invoke('library:delete-event', conferenceId);

contextBridge.exposeInMainWorld('indicoInk', {
  getAppInfo,
  openPdf,
  readPdfBytes,
  loadPdfWorkspaceState,
  savePdfWorkspaceState,
  listLibraryEvents,
  deleteLibraryEvent,
});

export type IndicoInkApi = {
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
