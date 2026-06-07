import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertLaunchArtifacts, getLaunchArtifacts } from './launchDiagnostics';
import { openPdfSelection } from './openPdf';
import { appendStartupLogEntry } from './startupLog';
import type { AppInfo } from './shared/appInfo';

let mainWindow: BrowserWindow | null = null;

if (process.env.INDICOINK_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

const getMainWindowDevServerUrl = () =>
  MAIN_WINDOW_VITE_DEV_SERVER_URL?.trim() ||
  process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL?.trim() ||
  '';

const getPackagedRendererPath = () =>
  join(app.getAppPath(), `.vite/renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);

const logStartupEvent = (source: string, detail: string) => {
  appendStartupLogEntry(app.getPath('userData'), source, detail);
};

const createWindow = () => {
  const packagedRendererPath = getPackagedRendererPath();
  const hasPackagedRenderer = existsSync(packagedRendererPath);
  const devServerUrl = getMainWindowDevServerUrl();

  logStartupEvent(
    'window:create',
    hasPackagedRenderer ? 'packaged' : 'dev-server',
  );

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    backgroundColor: '#f6f4ef',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (hasPackagedRenderer) {
    void mainWindow.loadFile(packagedRendererPath).catch((error) => {
      appendStartupLogEntry(app.getPath('userData'), 'window:load-file', error);
    });
  } else {
    const loadUrl = devServerUrl || 'http://localhost:5173';
    void mainWindow.loadURL(loadUrl).catch((error) => {
      appendStartupLogEntry(app.getPath('userData'), 'window:load-url', error);
    });
  }

  mainWindow.once('ready-to-show', () => {
    logStartupEvent('window:ready-to-show', 'showing window');
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logStartupEvent('window:did-finish-load', 'renderer loaded');
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      logStartupEvent(
        'window:did-fail-load',
        `${errorCode} ${errorDescription} ${validatedURL}`,
      );
    },
  );

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logStartupEvent('window:render-process-gone', JSON.stringify(details));
  });

  mainWindow.webContents.on(
    'cursor-changed',
    (_event, type, _image, scale, size, hotspot) => {
      logStartupEvent(
        'window:cursor-changed',
        JSON.stringify({ type, scale, size, hotspot }),
      );
    },
  );

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

ipcMain.handle('pdf:open', async () =>
  openPdfSelection((options) => dialog.showOpenDialog(options)),
);

ipcMain.handle(
  'pdf:read',
  async (_event, filePath: string) => new Uint8Array(await readFile(filePath)),
);

app.whenReady().then(() => {
  if (existsSync(getPackagedRendererPath())) {
    assertLaunchArtifacts(getLaunchArtifacts(__dirname, MAIN_WINDOW_VITE_NAME));
  }
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
