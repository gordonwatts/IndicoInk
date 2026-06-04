import { contextBridge, ipcRenderer } from 'electron';

import type { AppInfo } from './shared/appInfo';

const getAppInfo = async (): Promise<AppInfo> =>
  ipcRenderer.invoke('app:get-info');

contextBridge.exposeInMainWorld('indicoInk', {
  getAppInfo,
});

export type IndicoInkApi = {
  getAppInfo: () => Promise<AppInfo>;
};
