import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';

import { assertLaunchArtifacts, getLaunchArtifacts } from './launchDiagnostics';
import { appendStartupLogEntry } from './startupLog';
import type { AppInfo } from './shared/appInfo';

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.setName('IndicoInk');

const logStartupError = (source: string) => (error: unknown) => {
  appendStartupLogEntry(app.getPath('userData'), source, error);
};

process.on('uncaughtException', logStartupError('uncaughtException'));
process.on('unhandledRejection', logStartupError('unhandledRejection'));

ipcMain.handle(
  'app:get-info',
  (): AppInfo => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
  }),
);

app.whenReady().then(() => {
  assertLaunchArtifacts(getLaunchArtifacts(__dirname, MAIN_WINDOW_VITE_NAME));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
