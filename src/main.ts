import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertLaunchArtifacts, getLaunchArtifacts } from './launchDiagnostics';
import {
  buildLibraryEventSummaries,
  importConferenceFixtureByName,
} from './libraryData';
import { openPdfSelection } from './openPdf';
import { conferenceFixtures } from './conferenceFixtures';
import { PersistenceStore } from './persistenceStore';
import type { PdfWorkspaceSnapshot } from './shared/pdfWorkspace';
import {
  getIsolatedUserDataPath,
  shouldDisableGpu,
  shouldUseIsolatedUserData,
} from './runtimeModes';
import { appendStartupLogEntry } from './startupLog';
import type { AppInfo } from './shared/appInfo';

let mainWindow: BrowserWindow | null = null;
let persistenceStore: PersistenceStore | null = null;
const importFixtureName = getImportFixtureName(process.argv);

if (shouldDisableGpu()) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

if (shouldUseIsolatedUserData()) {
  app.setPath('userData', getIsolatedUserDataPath('IndicoInk'));
}

const getMainWindowDevServerUrl = () =>
  MAIN_WINDOW_VITE_DEV_SERVER_URL?.trim() ||
  process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL?.trim() ||
  '';

const getPackagedRendererPath = () =>
  join(__dirname, '../renderer/', MAIN_WINDOW_VITE_NAME, 'index.html');

const logStartupEvent = (source: string, detail: string) => {
  appendStartupLogEntry(app.getPath('userData'), source, detail);
};

const getPersistenceStore = () =>
  persistenceStore ??
  (persistenceStore = new PersistenceStore(
    join(app.getPath('userData'), 'indicoink-persistence.sqlite3'),
  ));

function getImportFixtureName(argv: string[]) {
  const argument = argv.find(
    (value) => value === '--import-fixture' || value.startsWith('--import-fixture='),
  );

  if (!argument) {
    return null;
  }

  if (argument.includes('=')) {
    const [, value] = argument.split('=', 2);
    return value?.trim() || null;
  }

  const index = argv.indexOf(argument);
  return argv[index + 1]?.trim() || null;
}

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
    void mainWindow.loadURL(pathToFileURL(packagedRendererPath).toString()).catch((error) => {
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

  mainWindow.webContents.on(
    'console-message',
    (_event, level, message, line, sourceId) => {
      logStartupEvent(
        'window:console-message',
        JSON.stringify({ level, message, line, sourceId }),
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
logStartupEvent(
  'launch:modes',
  JSON.stringify({
    isolatedUserData: shouldUseIsolatedUserData(),
    gpuDisabled: shouldDisableGpu(),
  }),
);

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

ipcMain.handle('library:list-events', async () =>
  buildLibraryEventSummaries(getPersistenceStore()),
);

ipcMain.handle('library:delete-event', async (_event, conferenceId: string) => {
  await getPersistenceStore().deleteConference(conferenceId);
});

ipcMain.handle('persistence:load-pdf-workspace', async (_event, sourceUrl: string) =>
  getPersistenceStore().loadLocalPdfWorkspace(sourceUrl),
);

ipcMain.handle(
  'persistence:save-pdf-workspace',
  async (_event, snapshot: PdfWorkspaceSnapshot) =>
    getPersistenceStore().saveLocalPdfWorkspace(snapshot),
);

app.whenReady().then(() => {
  if (importFixtureName) {
    if (!(importFixtureName in conferenceFixtures)) {
      appendStartupLogEntry(
        app.getPath('userData'),
        'fixture-import:error',
        `Unknown fixture name: ${importFixtureName}`,
      );
      app.exit(1);
      return;
    }

    void importConferenceFixtureByName(
      getPersistenceStore(),
      importFixtureName as keyof typeof conferenceFixtures,
    )
      .then((result) => {
        appendStartupLogEntry(
          app.getPath('userData'),
          'fixture-import:done',
          JSON.stringify(result),
        );
        app.exit(0);
      })
      .catch((error) => {
        appendStartupLogEntry(app.getPath('userData'), 'fixture-import:error', error);
        app.exit(1);
      });
    return;
  }

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
