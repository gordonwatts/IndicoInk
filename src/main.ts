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
import { AgendaDownloadManager } from './agendaDownload';
import { importIndicoEvent } from './indicoImport';
import { refreshIndicoEvent, resolveLinkedAgendaUrl } from './indicoRefresh';
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
import { createConferenceId } from './persistenceModels';
import type { PdfWorkspaceChangeBatch } from './shared/pdfWorkspace';
import type {
  ConferenceExportSnapshot,
  ExportDeckSnapshot,
  ExportSlideSnapshot,
  ExportTalkSnapshot,
  ExportNotePageSnapshot,
} from './shared/exportNotes';
import { sortExportTalks } from './exportOrder';
import { DeckCacheManager } from './deckCache';
import type { DeckCacheDownloadStatus } from './shared/deckCache';
import type {
  AgendaDownloadStatus,
  AgendaDownloadSummary,
} from './shared/agendaDownload';
import {
  getIsolatedUserDataPath,
  getPersistenceDbPath,
  shouldDisableGpu,
  shouldUseIsolatedUserData,
} from './runtimeModes';
import { appendStartupLogEntry } from './startupLog';
import type { AppInfo } from './shared/appInfo';
import type { AppSettings } from './shared/appSettings';
import { parseIndicoEventSessionUrl, parseIndicoEventUrl } from './indicoEvent';
import { getIndicoEventUrlFromArgs } from './launchEventUrl';
import type {
  OpenLibraryEventResult,
  RefreshLibraryEventResult,
} from './shared/library';
import type { IndicoApiKeySummary } from './shared/indicoCredentials';
import type {
  OpenAiConfigurationInput,
  OpenAiConfigurationSummary,
} from './shared/openAi';
import {
  WebAgendaAuthenticationError,
  normalizeOpenAiBaseUrl,
  normalizeWebAgendaUrl,
} from './webAgenda';
import { importWebAgenda, refreshWebAgenda } from './webAgendaImport';
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
let agendaDownloadManager: AgendaDownloadManager | null = null;
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

const getOpenAiConfiguration = () => {
  const settings = ensureAppSettings();
  return {
    baseUrl: settings.openAiBaseUrl,
    model: settings.openAiModel,
    reasoningEffort: settings.openAiReasoningEffort,
  };
};

const getLlmConfigurationRequiredResult = (
  reason: 'missing' | 'authentication-failed',
) => ({
  kind: 'llm-configuration-required' as const,
  reason,
  message:
    reason === 'authentication-failed'
      ? 'OpenAI authentication failed. Review the endpoint and model, then provide a replacement API key.'
      : 'Configure OpenAI before importing an event webpage.',
});

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
    undefined,
    undefined,
    (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deck:download-progress', status);
      }
    },
  ));

const getAgendaDownloadManager = () =>
  agendaDownloadManager ??
  (agendaDownloadManager = new AgendaDownloadManager(
    getPersistenceStore(),
    (deck, onStatus) =>
      getDeckCacheManager().ensureDeckAvailable(deck, onStatus),
    (deck) => getDeckCacheManager().isDeckCached(deck),
  ));

const toExportAnnotation = (annotation: {
  id: string;
  points?: Array<{ x: number; y: number; pressure: number; time: number }>;
  x?: number;
  y?: number;
  text?: string;
  color?: string;
}) =>
  annotation.points
    ? {
        id: annotation.id,
        kind: 'stroke' as const,
        points: annotation.points,
        ...(annotation.color ? { color: annotation.color } : {}),
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
  talkId?: string | null,
): Promise<ConferenceExportSnapshot | null> => {
  const store = getPersistenceStore();
  const conference = await store.getConference(conferenceId);
  if (!conference) {
    return null;
  }

  const talks = (await store.listTalksByConference(conferenceId)).filter(
    (talk) => !talkId || talk.id === talkId,
  );
  const exportTalks: ExportTalkSnapshot[] = [];
  const restoredDecks: Array<{ talkTitle: string; deckDisplayName: string }> =
    [];

  for (const talk of talks) {
    const decks = (await store.listDecksByTalk(talk.id)).filter(
      (deck) => deck.kind !== 'notebook',
    );
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

        const availability =
          await getDeckCacheManager().ensureDeckAvailable(deck);
        if (availability.kind !== 'ready') {
          throw new Error(
            `Unable to restore ${deck.displayName} for “${talk.title}”: ${availability.message}`,
          );
        }
        if (availability.restored) {
          restoredDecks.push({
            talkTitle: talk.title,
            deckDisplayName: deck.displayName,
          });
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

    const notebookDeck = (await store.listDecksByTalk(talk.id)).find(
      (deck) => deck.kind === 'notebook',
    );
    const exportNotes: ExportNotePageSnapshot[] = [];
    if (notebookDeck) {
      const noteSlides = await store.listSlidesByDeck(notebookDeck.id);
      for (const noteSlide of noteSlides) {
        if (!noteSlide.annotated) {
          continue;
        }
        const annotations = await store.listAnnotationsBySlide(noteSlide.id);
        if (!annotations.length) {
          continue;
        }
        exportNotes.push({
          id: noteSlide.id,
          pageNumber: noteSlide.slideNumber,
          referenceSlideNumber: null,
          annotations: annotations.map((annotation) =>
            toExportAnnotation(annotation),
          ),
        });
      }
    }

    if (exportDecks.length > 0 || exportNotes.length > 0) {
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
        ...(exportNotes.length ? { notes: exportNotes } : {}),
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
    talks: sortExportTalks(exportTalks),
    ...(restoredDecks.length ? { restoredDecks } : {}),
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
    icon: join(app.getAppPath(), 'assets', 'icons', 'indicoink.ico'),
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Explicitly remove any platform-provided menu attached to the window.
  mainWindow.removeMenu();

  mainWindow.webContents.on('did-start-loading', () => {
    rendererAcceptsLaunchRequests = false;
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

  let allowWorkspaceClose = false;
  const workspaceWindow = mainWindow;
  workspaceWindow.on('close', (event) => {
    if (allowWorkspaceClose || workspaceWindow.isDestroyed()) {
      return;
    }
    event.preventDefault();
    const rendererFlush = workspaceWindow.webContents.executeJavaScript(
      'globalThis.__indicoInkFlushWorkspace?.()',
    );
    const flushTimeout = new Promise<void>((resolve) => {
      setTimeout(resolve, 5_000);
    });
    void Promise.race([rendererFlush, flushTimeout])
      .catch((error) => {
        appendStartupLogEntry(
          app.getPath('userData'),
          'workspace:flush-before-close',
          error,
        );
      })
      .finally(() => {
        allowWorkspaceClose = true;
        if (!workspaceWindow.isDestroyed()) {
          workspaceWindow.close();
        }
      });
  });

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
let pendingIndicoEventUrl = getIndicoEventUrlFromArgs(process.argv);
let rendererAcceptsLaunchRequests = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const requestedEventUrl = getIndicoEventUrlFromArgs(commandLine);
    if (requestedEventUrl) {
      logStartupEvent('launch:indico-url', {
        present: true,
        source: 'second-instance',
      });
      pendingIndicoEventUrl = requestedEventUrl;
      if (
        rendererAcceptsLaunchRequests &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) {
        pendingIndicoEventUrl = null;
        mainWindow.webContents.send(
          'app:open-indico-event-url',
          requestedEventUrl,
        );
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

const startupIndicoEventUrl = pendingIndicoEventUrl;
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
  async (): Promise<string | null> => {
    rendererAcceptsLaunchRequests = true;
    const eventUrl = pendingIndicoEventUrl;
    pendingIndicoEventUrl = null;
    return eventUrl;
  },
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

ipcMain.handle('agenda:download-start', async (_event, conferenceId: string) =>
  getAgendaDownloadManager().startDownload(conferenceId),
);

ipcMain.handle(
  'agenda:download-status',
  async (_event, operationId: string): Promise<AgendaDownloadStatus | null> =>
    getAgendaDownloadManager().getDownloadStatus(operationId),
);

ipcMain.handle(
  'agenda:download-summary',
  async (_event, conferenceId: string): Promise<AgendaDownloadSummary> =>
    getAgendaDownloadManager().getDownloadSummary(conferenceId),
);

ipcMain.handle(
  'agenda:download-cancel',
  async (_event, operationId: string): Promise<void> => {
    getAgendaDownloadManager().cancelDownload(operationId);
  },
);

ipcMain.handle(
  'agenda:resolve-linked-agenda',
  async (_event, sessionUrl: string): Promise<string | null> => {
    const identity = parseIndicoEventSessionUrl(sessionUrl);
    if (!identity) {
      return null;
    }

    const apiKey = await getCredentialStore().getApiKey(identity.origin);
    return resolveLinkedAgendaUrl(identity.canonicalEventUrl, sessionUrl, {
      fetchImpl: session.defaultSession.fetch.bind(session.defaultSession),
      ...(apiKey ? { apiKey } : {}),
    });
  },
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
    const requestedIndicoIdentity = parseIndicoEventUrl(eventUrl);
    const fetchImpl = session.defaultSession.fetch.bind(session.defaultSession);
    const normalizedUrl = requestedIndicoIdentity
      ? requestedIndicoIdentity.canonicalEventUrl
      : normalizeWebAgendaUrl(eventUrl);
    const conferenceId = requestedIndicoIdentity
      ? requestedIndicoIdentity.conferenceId
      : createConferenceId(normalizedUrl);
    const conference = await getPersistenceStore().getConference(conferenceId);
    if (!conference) {
      throw new Error('The requested event does not exist locally.');
    }

    if (conference.sourceKind !== 'web') {
      const identity = parseIndicoEventUrl(conference.sourceUrl);
      if (!identity) {
        throw new Error('The saved Indico event URL is invalid.');
      }
      const apiKey = await getCredentialStore().getApiKey(identity.origin);
      try {
        return await refreshIndicoEvent(
          getPersistenceStore(),
          conference.sourceUrl,
          {
            fetchImpl,
            ...(apiKey ? { apiKey } : {}),
            onProgress: (stage) =>
              _event.sender.send('agenda:progress', {
                operation: 'refresh',
                stage,
              }),
            ...(decision ? { decision } : {}),
          },
        );
      } catch (error) {
        const refreshError = classifyRefreshError(error, identity);
        if (refreshError) {
          return refreshError;
        }
        throw error;
      }
    }

    const openAiApiKey = await getCredentialStore().getOpenAiApiKey();
    if (!openAiApiKey) {
      return {
        ...getLlmConfigurationRequiredResult('missing'),
        conferenceId,
      };
    }

    try {
      return await refreshWebAgenda(
        getPersistenceStore(),
        conference.sourceUrl,
        {
          configuration: getOpenAiConfiguration(),
          apiKey: openAiApiKey,
          fetchImpl,
          onProgress: (stage) =>
            _event.sender.send('agenda:progress', {
              operation: 'refresh',
              stage,
            }),
          ...(decision ? { decision } : {}),
        },
      );
    } catch (error) {
      if (error instanceof WebAgendaAuthenticationError) {
        return {
          ...getLlmConfigurationRequiredResult('authentication-failed'),
          conferenceId,
        };
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
    const fetchImpl = session.defaultSession.fetch.bind(session.defaultSession);
    if (identity) {
      const storedApiKey =
        apiKey ?? (await getCredentialStore().getApiKey(identity.origin));
      try {
        const fetchOptions = storedApiKey
          ? { apiKey: storedApiKey }
          : undefined;
        const result = await importIndicoEvent(
          getPersistenceStore(),
          eventUrl,
          {
            fetchImpl,
            ...(fetchOptions ?? {}),
            onProgress: (stage) =>
              _event.sender.send('agenda:progress', {
                operation: 'open',
                stage,
              }),
          },
        );
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
    }

    const normalizedUrl = normalizeWebAgendaUrl(eventUrl);
    const openAiApiKey = await getCredentialStore().getOpenAiApiKey();
    if (!openAiApiKey) {
      return getLlmConfigurationRequiredResult('missing');
    }
    try {
      const result = await importWebAgenda(
        getPersistenceStore(),
        normalizedUrl,
        {
          configuration: getOpenAiConfiguration(),
          apiKey: openAiApiKey,
          fetchImpl,
          onProgress: (stage) =>
            _event.sender.send('agenda:progress', {
              operation: 'open',
              stage,
            }),
        },
      );
      return { kind: 'opened', result };
    } catch (error) {
      if (error instanceof WebAgendaAuthenticationError) {
        return getLlmConfigurationRequiredResult('authentication-failed');
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
  'openai:get-configuration',
  async (): Promise<OpenAiConfigurationSummary> =>
    getCredentialStore().getOpenAiConfigurationSummary(
      getOpenAiConfiguration(),
    ),
);

ipcMain.handle(
  'openai:save-configuration',
  async (
    _event,
    input: OpenAiConfigurationInput,
  ): Promise<OpenAiConfigurationSummary> => {
    const apiKey = input.apiKey.trim();
    const model = input.model.trim();
    if (!apiKey || !model) {
      throw new Error('OpenAI model and API key are required.');
    }
    const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl);
    const current = ensureAppSettings();
    appSettings = coerceAppSettings({
      ...current,
      openAiBaseUrl: baseUrl,
      openAiModel: model,
      openAiReasoningEffort: input.reasoningEffort,
    });
    saveAppSettings(getUserDataPath(), appSettings);
    await getCredentialStore().saveOpenAiApiKey(apiKey);
    return getCredentialStore().getOpenAiConfigurationSummary(
      getOpenAiConfiguration(),
    );
  },
);

ipcMain.handle('openai:delete-api-key', async (): Promise<void> => {
  await getCredentialStore().deleteOpenAiApiKey();
});

ipcMain.handle(
  'persistence:load-pdf-workspace',
  async (_event, sourceUrl: string) =>
    getPersistenceStore().loadLocalPdfWorkspace(sourceUrl),
);

ipcMain.handle(
  'persistence:save-pdf-workspace-changes',
  async (_event, batch: PdfWorkspaceChangeBatch) =>
    getPersistenceStore().saveLocalPdfWorkspaceChanges(batch),
);

ipcMain.handle(
  'persistence:load-deck-workspace',
  async (_event, deckId: string) =>
    getPersistenceStore().loadDeckPdfWorkspace(deckId),
);

ipcMain.handle(
  'persistence:ensure-notebook-deck',
  async (_event, talkId: string) =>
    getPersistenceStore().ensureNotebookDeck(talkId),
);

ipcMain.handle(
  'persistence:save-deck-workspace-changes',
  async (_event, batch: PdfWorkspaceChangeBatch) =>
    getPersistenceStore().saveDeckPdfWorkspaceChanges(batch),
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
  async (_event, conferenceId: string, talkId?: string | null) =>
    buildConferenceExportSnapshot(conferenceId, talkId),
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
