import { contextBridge, ipcRenderer } from 'electron';

import type { AppInfo } from './shared/appInfo';
import type { PdfSelection } from './openPdf';

const getAppInfo = async (): Promise<AppInfo> =>
  ipcRenderer.invoke('app:get-info');

const openPdf = async (): Promise<PdfSelection> => ipcRenderer.invoke('pdf:open');

const readPdfBytes = async (filePath: string): Promise<Uint8Array> =>
  ipcRenderer.invoke('pdf:read', filePath);

contextBridge.exposeInMainWorld('indicoInk', {
  getAppInfo,
  openPdf,
  readPdfBytes,
});

export type IndicoInkApi = {
  getAppInfo: () => Promise<AppInfo>;
  openPdf: () => Promise<PdfSelection>;
  readPdfBytes: (filePath: string) => Promise<Uint8Array>;
};
