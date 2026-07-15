import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  safeStorage,
  session,
} from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertLaunchArtifacts, getLaunchArtifacts } from './launchDiagnostics';
import {
  buildLibraryEventSummaries,
  importConferenceFixtureByName,
} from './libraryData';
import { buildAgendaTalkSummaries } from './agendaData';
import { importIndicoEvent } from './indicoImport';
import { refreshIndicoEvent } from './indicoRefresh';
import { classifyRefreshError } from './refreshResult';
import { IndicoCredentialStore } from './indicoCredentials';
import {
  getIndicoApiKeyPromptMessage,
  isLikelyIndicoApiKeyError,
} from './indicoHttp';
import { IndicoHttpError } from './indicoHttp';
import { openPdfSelection } from './openPdf';
import { conferenceFixtures } from './conferenceFixtures';
import { PersistenceStore } from './persistenceStore';
import type { PdfWorkspaceSnapshot } from './shared/pdfWorkspace';
import type {
  ConferenceExportSnapshot,
  ExportDeckSnapshot,
  ExportSlideSnapshot,
  ExportTalkSnapshot,
} from './shared/exportNotes';
import { DeckCacheManager } from './deckCache';
import type { DeckCacheDownloadStatus } from './shared/deckCache';
import {
  getIsolatedUserDataPath,
  getPersistenceDbPath,
  shouldDisableGpu,
  shouldUseIsolatedUserData,
} from './runtimeModes';
import { appendStartupLogEntry } from './startupLog';
import type { AppInfo } from './shared/appInfo';
import type { AppSettings } from './shared/appSettings';
import { parseIndicoEventUrl } from './indicoEvent';
import type {
  OpenLibraryEventResult,
  RefreshLibraryEventResult,
} from './shared/library';
import type { IndicoApiKeySummary } from './shared/indicoCredentials';
import {
  coerceAppSettings,
  loadAppSettings,
  saveAppSettings,
} from './appSettings';

if (squirrelStartup) {
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let persistenceStore: PersistenceStore | null = null;
let credentialStore: IndicoCredentialStore | null = null;
let deckCacheManager: DeckCacheManager | null = null;
let appSettings: AppSettings | null = null;
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

const getUserDataPath = () => app.getPath('userData');

const ensureAppSettings = () =>
  appSettings ?? (appSettings = loadAppSettings(getUserDataPath()));

const shouldRecordStartupLogs = () =>
  process.env.INDICOINK_RECORD_LOGGING === '1' ||
  ensureAppSettings().recordLogging;

const logStartupEvent = (source: string, detail: unknown) => {
  appendStartupLogEntry(getUserDataPath(), source, detail, {
    enabled: shouldRecordStartupLogs(),
  });
};

const getPersistenceStore = () =>
  persistenceStore ??
  (persistenceStore = new PersistenceStore(
    getPersistenceDbPath(app.getPath('userData')),
  ));

const getCredentialStore = () =>
  credentialStore ??
  (credentialStore = new IndicoCredentialStore(
    join(getUserDataPath(), 'indicoink-credentials.json'),
    safeStorage,
  ));

const getStoredApiKeyForUrl = async (url: string) => {
  const origin = new URL(url).origin;
  return getCredentialStore().getApiKey(origin);
};

const getDeckCacheManager = () =>
  deckCacheManager ??
  (deckCacheManager = new DeckCacheManager(
    join(getUserDataPath(), 'deck-cache'),
    session.defaultSession.fetch.bind(session.defaultSession),
    getStoredApiKeyForUrl,
  ));

const toExportAnnotation = (annotation: {
  id: string;
  points?: Array<{ x: number; y: number; pressure: number; time: number }>;
  x?: number;
  y?: number;
  text?: string;
}) =>
  annotation.points
    ? {
        id: annotation.id,
        kind: 'stroke' as const,
        points: annotation.points,
      }
    : {
        id: annotation.id,
        kind: 'text' as const,
        x: annotation.x ?? 0,
        y: annotation.y ?? 0,
        text: annotation.text ?? '',
      };

const buildConferenceExportSnapshot = async (
  conferenceId: string,
): Promise<ConferenceExportSnapshot | null> => {
  const store = getPersistenceStore();
  const conference = await store.getConference(conferenceId);
  if (!conference) {
    return null;
  }

  const talks = await store.listTalksByConference(conferenceId);
  const exportTalks: ExportTalkSnapshot[] = [];

  for (const talk of talks) {
    const decks = await store.listDecksByTalk(talk.id);
    const exportDecks: ExportDeckSnapshot[] = [];

    for (const deck of decks) {
      const slides = await store.listSlidesByDeck(deck.id);
      const exportSlides: ExportSlideSnapshot[] = [];

      for (const slide of slides) {
        if (!slide.annotated) {
          continue;
        }

        const annotations = await store.listAnnotationsBySlide(slide.id);
        if (!annotations.length) {
          continue;
        }

        exportSlides.push({
          id: slide.id,
          slideNumber: slide.slideNumber,
          filePath: getDeckCacheManager().getCacheFilePath(
            conferenceId,
            deck.id,
          ),
          annotations: annotations.map((annotation) =>
            toExportAnnotation(annotation),
          ),
        });
      }

      if (exportSlides.length > 0) {
        exportDecks.push({
          id: deck.id,
          displayName: deck.displayName,
          sourceUrl: deck.sourceUrl,
          filePath: getDeckCacheManager().getCacheFilePath(
            conferenceId,
            deck.id,
          ),
          selected: deck.selected,
          slides: exportSlides,
        });
      }
    }

    if (exportDecks.length > 0) {
      exportTalks.push({
        id: talk.id,
        contributionId: talk.contributionId,
        contributionUrl: talk.contributionUrl,
        title: talk.title,
        speaker: talk.speaker,
        sessionTitle: talk.sessionTitle,
        startsAt: talk.startsAt,
        endsAt: talk.endsAt,
        room: talk.room,
        bookmarked: talk.bookmarked,
        decks: exportDecks,
      });
    }
  }

  return {
    conference: {
      id: conference.id,
      title: conference.title,
      dates: conference.dates,
      host: conference.host,
      sourceUrl: conference.sourceUrl,
      exportedAt: Date.now(),
    },
    talks: exportTalks,
  };
};

function getImportFixtureName(argv: string[]) {
  const argument = argv.find(
    (value) =>
      value === '--import-fixture' || value.startsWith('--import-fixture='),
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

function getStartupIndicoEventUrl(argv: string[]) {
  const explicitArg = argv.find(
    (value) => value === '--indico-url' || value.startsWith('--indico-url='),
  );

  if (explicitArg) {
    if (explicitArg.includes('=')) {
      const [, value] = explicitArg.split('=', 2);
      return value?.trim() || null;
    }

    const index = argv.indexOf(explicitArg);
    return argv[index + 1]?.trim() || null;
  }

  const directUrl = argv.find((value) =>
    /^https:\/\/[^ ]+\/event\/[^ ]+/.test(value),
  );

  return directUrl?.trim() || null;
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
ensureAppSettings();
logStartupEvent(
  'launch:modes',
  JSON.stringify({
    isolatedUserData: shouldUseIsolatedUserData(),
    gpuDisabled: shouldDisableGpu(),
  }),
);
const startupIndicoEventUrl = getStartupIndicoEventUrl(process.argv);
if (startupIndicoEventUrl) {
  logStartupEvent('launch:indico-url', { present: true });
}

const logStartupError = (source: string) => (error: unknown) => {
  appendStartupLogEntry(getUserDataPath(), source, error, { force: true });
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

ipcMain.handle(
  'app:get-data-folder',
  async (): Promise<string> => app.getPath('userData'),
);

ipcMain.handle(
  'app:get-settings',
  async (): Promise<AppSettings> => ensureAppSettings(),
);

ipcMain.handle(
  'app:set-settings',
  async (_event, settings: AppSettings): Promise<AppSettings> => {
    const normalizedSettings = coerceAppSettings(settings);
    appSettings = normalizedSettings;
    saveAppSettings(getUserDataPath(), normalizedSettings);
    return normalizedSettings;
  },
);

ipcMain.handle(
  'app:get-startup-indico-url',
  async (): Promise<string | null> => getStartupIndicoEventUrl(process.argv),
);

ipcMain.handle('pdf:open', async () =>
  openPdfSelection((options) => dialog.showOpenDialog(options)),
);

ipcMain.handle('system:open-data-folder', async (): Promise<void> => {
  await shell.openPath(app.getPath('userData'));
});

ipcMain.handle(
  'pdf:read',
  async (_event, filePath: string) => new Uint8Array(await readFile(filePath)),
);

ipcMain.handle('library:list-events', async () =>
  buildLibraryEventSummaries(getPersistenceStore()),
);

ipcMain.handle('agenda:list-talks', async (_event, conferenceId: string) =>
  buildAgendaTalkSummaries(getPersistenceStore(), conferenceId),
);

ipcMain.handle(
  'agenda:set-talk-bookmarked',
  async (_event, talkId: string, bookmarked: boolean) => {
    await getPersistenceStore().setTalkBookmarked(talkId, bookmarked);
  },
);

ipcMain.handle(
  'system:open-external-url',
  async (_event, url: string): Promise<void> => {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http and https URLs can be opened.');
    }

    await shell.openExternal(parsedUrl.toString());
  },
);

ipcMain.handle('library:delete-event', async (_event, conferenceId: string) => {
  await getPersistenceStore().deleteConference(conferenceId);
});

ipcMain.handle(
  'library:refresh-event',
  async (
    _event,
    eventUrl: string,
    decision?: 'keep' | 'replace',
  ): Promise<RefreshLibraryEventResult> => {
    const identity = parseIndicoEventUrl(eventUrl);
    if (!identity) {
      throw new Error('The provided URL is not a valid Indico event.');
    }

    const apiKey = await getCredentialStore().getApiKey(identity.origin);

    try {
      return await refreshIndicoEvent(getPersistenceStore(), eventUrl, {
        fetchImpl: session.defaultSession.fetch.bind(session.defaultSession),
        ...(apiKey ? { apiKey } : {}),
        ...(decision ? { decision } : {}),
      });
    } catch (error) {
      const refreshError = classifyRefreshError(error, identity);
      if (refreshError) {
        return refreshError;
      }

      throw error;
    }
  },
);

ipcMain.handle(
  'library:open-event',
  async (
    _event,
    eventUrl: string,
    apiKey?: string,
  ): Promise<OpenLibraryEventResult> => {
    const identity = parseIndicoEventUrl(eventUrl);
    if (!identity) {
      throw new Error('The provided URL is not a valid Indico event.');
    }

    const storedApiKey =
      apiKey ?? (await getCredentialStore().getApiKey(identity.origin));

    try {
      const fetchImpl = session.defaultSession.fetch.bind(
        session.defaultSession,
      );
      const fetchOptions = storedApiKey ? { apiKey: storedApiKey } : undefined;
      const result = await importIndicoEvent(getPersistenceStore(), eventUrl, {
        fetchImpl,
        ...(fetchOptions ?? {}),
      });
      return {
        kind: 'opened',
        result,
      };
    } catch (error) {
      if (
        error instanceof IndicoHttpError &&
        isLikelyIndicoApiKeyError(error.statusCode, error.responseBody)
      ) {
        return {
          kind: 'api-key-required',
          origin: identity.origin,
          message: getIndicoApiKeyPromptMessage(
            error.statusCode,
            error.responseBody,
          ),
        };
      }

      throw error;
    }
  },
);

ipcMain.handle(
  'indico:save-api-key',
  async (_event, origin: string, apiKey: string) => {
    await getCredentialStore().saveApiKey(origin, apiKey);
  },
);

ipcMain.handle(
  'indico:list-api-keys',
  async (): Promise<IndicoApiKeySummary[]> =>
    getCredentialStore().listApiKeys(),
);

ipcMain.handle('indico:delete-api-key', async (_event, origin: string) => {
  await getCredentialStore().deleteApiKey(origin);
});

ipcMain.handle(
  'persistence:load-pdf-workspace',
  async (_event, sourceUrl: string) =>
    getPersistenceStore().loadLocalPdfWorkspace(sourceUrl),
);

ipcMain.handle(
  'persistence:save-pdf-workspace',
  async (_event, snapshot: PdfWorkspaceSnapshot) =>
    getPersistenceStore().saveLocalPdfWorkspace(snapshot),
);

ipcMain.handle(
  'persistence:load-deck-workspace',
  async (_event, deckId: string) =>
    getPersistenceStore().loadDeckPdfWorkspace(deckId),
);

ipcMain.handle(
  'persistence:save-deck-workspace',
  async (_event, snapshot: PdfWorkspaceSnapshot) =>
    getPersistenceStore().saveDeckPdfWorkspace(snapshot),
);

ipcMain.handle(
  'agenda:set-selected-deck',
  async (_event, talkId: string, deckId: string) => {
    await getPersistenceStore().setSelectedDeckForTalk(talkId, deckId);
  },
);

ipcMain.handle(
  'deck:open',
  async (_event, conferenceId: string, talkId: string, deckId: string) => {
    const deck = await getPersistenceStore().getDeck(deckId);
    if (!deck || deck.conferenceId !== conferenceId || deck.talkId !== talkId) {
      throw new Error('The requested deck does not exist.');
    }

    await getPersistenceStore().touchConference(conferenceId);
    return getDeckCacheManager().openDeck(deck);
  },
);

ipcMain.handle(
  'deck:download-status',
  async (
    _event,
    operationId: string,
  ): Promise<DeckCacheDownloadStatus | null> =>
    getDeckCacheManager().getDownloadStatus(operationId),
);

ipcMain.handle('deck:cancel-download', async (_event, operationId: string) => {
  await getDeckCacheManager().cancelDownload(operationId);
});

ipcMain.handle(
  'export:get-conference-snapshot',
  async (_event, conferenceId: string) =>
    buildConferenceExportSnapshot(conferenceId),
);

ipcMain.handle(
  'export:show-save-dialog',
  async (
    _event,
    options: {
      defaultPath: string;
      title: string;
    },
  ) => {
    const testExportPath = process.env.INDICOINK_EXPORT_TEST_PATH?.trim();
    if (testExportPath) {
      return {
        canceled: false,
        filePath: testExportPath,
      };
    }

    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          title: options.title,
          defaultPath: options.defaultPath,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        })
      : await dialog.showSaveDialog({
          title: options.title,
          defaultPath: options.defaultPath,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });

    return {
      canceled: result.canceled,
      filePath: result.filePath ?? null,
    };
  },
);

ipcMain.handle(
  'export:write-file',
  async (_event, filePath: string, contents: string) => {
    await writeFile(filePath, contents, 'utf8');
  },
);

ipcMain.handle(
  'export:open-file-location',
  async (_event, filePath: string) => {
    await shell.showItemInFolder(filePath);
  },
);

app.whenReady().then(() => {
  if (importFixtureName) {
    if (!(importFixtureName in conferenceFixtures)) {
      appendStartupLogEntry(
        app.getPath('userData'),
        'fixture-import:error',
        `Unknown fixture name: ${importFixtureName}`,
        { enabled: shouldRecordStartupLogs() },
      );
      app.exit(1);
      return;
    }

    void importConferenceFixtureByName(
      getPersistenceStore(),
      importFixtureName as keyof typeof conferenceFixtures,
      Date.now(),
      join(app.getPath('userData'), 'deck-cache'),
    )
      .then((result) => {
        appendStartupLogEntry(
          app.getPath('userData'),
          'fixture-import:done',
          JSON.stringify(result),
          { enabled: shouldRecordStartupLogs() },
        );
        app.exit(0);
      })
      .catch((error) => {
        appendStartupLogEntry(
          app.getPath('userData'),
          'fixture-import:error',
          error,
          { enabled: shouldRecordStartupLogs() },
        );
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
