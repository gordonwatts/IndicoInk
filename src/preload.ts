import { contextBridge, ipcRenderer } from 'electron';

import type { AppInfo } from './shared/appInfo';
import type { PdfSelection } from './openPdf';
import type {
  PdfWorkspaceSaveResult,
  PdfWorkspaceSnapshot,
} from './shared/pdfWorkspace';

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

contextBridge.exposeInMainWorld('indicoInk', {
  getAppInfo,
  openPdf,
  readPdfBytes,
  loadPdfWorkspaceState,
  savePdfWorkspaceState,
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
};
