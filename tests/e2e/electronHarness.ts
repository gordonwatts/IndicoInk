import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

import { getIsolatedPersistenceDbPath } from '../../src/runtimeModes';
import { startupLogFileName } from '../../src/startupLog';

const electronPath = resolve('node_modules/electron/dist/electron.exe');
const electronCacheRoot = resolve('.electron-cache');
const electronDistPath = resolve('node_modules/electron/dist');
const packagedOutRoot = resolve('out');
const pickEnv = (keys: string[]) =>
  Object.fromEntries(
    keys
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

const isPackagedAppBinary = (filePath: string) => {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);

  return (
    fileName.endsWith('.exe') &&
    !normalized.includes('/make/') &&
    !fileName.startsWith('setup') &&
    !fileName.startsWith('update') &&
    !fileName.startsWith('unins')
  );
};

export const resolvePackagedElectronBinary = () => {
  const explicitPath = process.env.INDICOINK_PACKAGED_EXE_PATH?.trim();
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(
        `INDICOINK_PACKAGED_EXE_PATH points to a missing file: ${explicitPath}`,
      );
    }

    return explicitPath;
  }

  if (!existsSync(packagedOutRoot)) {
    throw new Error(
      'Packaged output was not found. Run `npm run package` before launching the packaged app.',
    );
  }

  const candidates: string[] = [];
  const stack = [packagedOutRoot];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() !== 'make') {
          stack.push(entryPath);
        }
        continue;
      }

      if (entry.isFile() && isPackagedAppBinary(entryPath)) {
        candidates.push(entryPath);
      }
    }
  }

  const exactMatch = candidates.find((candidate) =>
    /(?:^|\\|\/)indicoink\.exe$/i.test(candidate),
  );
  if (exactMatch) {
    return exactMatch;
  }

  const fallback = candidates[0];
  if (fallback) {
    return fallback;
  }

  throw new Error(
    'No packaged app executable was found under out/. Run `npm run package` first.',
  );
};

export const resolvePackagedAppAsarPath = () => {
  const explicitPath = process.env.INDICOINK_PACKAGED_ASAR_PATH?.trim();
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(
        `INDICOINK_PACKAGED_ASAR_PATH points to a missing file: ${explicitPath}`,
      );
    }

    return explicitPath;
  }

  if (!existsSync(packagedOutRoot)) {
    throw new Error(
      'Packaged output was not found. Run `npm run package` before launching the packaged app.',
    );
  }

  const stack = [packagedOutRoot];
  const candidates: string[] = [];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase() === 'app.asar') {
        candidates.push(entryPath);
      }
    }
  }

  const preferredCandidate = candidates.find((candidate) =>
    /(?:^|\\|\/)indicoink-win32-(?:x64|arm64)(?:\\|\/)resources(?:\\|\/)app\.asar$/i.test(
      candidate,
    ),
  );
  if (preferredCandidate) {
    return preferredCandidate;
  }

  const fallback = candidates[0];
  if (fallback) {
    return fallback;
  }

  throw new Error(
    'Packaged app.asar was not found. Run `npm run package` before launching the packaged app.',
  );
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

const reserveFreePort = async () => {
  const server = createServer();
  await new Promise<void>((resolveReserve, rejectReserve) => {
    server.once('error', rejectReserve);
    server.listen(0, '127.0.0.1', () => resolveReserve());
  });

  const address = server.address();
  if (
    typeof address !== 'object' ||
    !address ||
    typeof address.port !== 'number'
  ) {
    server.close();
    throw new Error('Failed to reserve a debugging port.');
  }

  const port = address.port;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });

  return port;
};

const waitFor = async (
  check: () => boolean,
  timeoutMilliseconds: number,
  intervalMilliseconds = 250,
) => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await wait(intervalMilliseconds);
  }

  throw new Error('Timed out waiting for Electron startup.');
};

const waitForCdpEndpoint = async (port: number) => {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Electron exposes the CDP endpoint.
    }

    await wait(250);
  }

  throw new Error('Timed out waiting for the Electron CDP endpoint.');
};

export type ElectronHarness = {
  browser: Browser;
  page: Page;
  userDataDir: string;
  child: ChildProcess;
  close: () => Promise<void>;
};

export type LaunchElectronHarnessOptions = {
  userDataDir?: string;
  extraEnv?: NodeJS.ProcessEnv;
};

export type ImportFixtureOptions = {
  userDataDir: string;
  fixtureName: 'small' | 'large' | 'packaged';
};

type LaunchBinaryHarnessOptions = {
  binaryPath: string;
  launchArgs: string[];
  userDataDir?: string;
  extraEnv?: NodeJS.ProcessEnv;
  useElectronDevEnv?: boolean;
};

const launchBinaryHarness = async ({
  binaryPath,
  launchArgs,
  userDataDir: userDataDirOverride,
  extraEnv,
  useElectronDevEnv = true,
}: LaunchBinaryHarnessOptions): Promise<ElectronHarness> => {
  const userDataDir =
    userDataDirOverride ?? mkdtempSync(resolve(tmpdir(), 'indicoink-e2e-'));
  const startupLogPath = join(userDataDir, 'startup.log');
  const remoteDebuggingPort = await reserveFreePort();

  const child = spawn(
    binaryPath,
    [
      `--remote-debugging-port=${remoteDebuggingPort}`,
      '--disable-gpu',
      '--disable-software-rasterizer',
      `--user-data-dir=${userDataDir}`,
      ...launchArgs,
    ],
    {
      env: {
        ...pickEnv([
          'PATH',
          'SystemRoot',
          'WINDIR',
          'TEMP',
          'TMP',
          'APPDATA',
          'LOCALAPPDATA',
          'USERPROFILE',
          'HOME',
          'HOMEDRIVE',
          'HOMEPATH',
          'PROCESSOR_ARCHITECTURE',
          'ComSpec',
        ]),
        INDICOINK_ISOLATED_USER_DATA: '1',
        INDICOINK_USER_DATA_DIR: userDataDir,
        INDICOINK_PERSISTENCE_DB_PATH:
          getIsolatedPersistenceDbPath(userDataDir),
        INDICOINK_DISABLE_GPU: '1',
        INDICOINK_RECORD_LOGGING: '1',
        ...(useElectronDevEnv
          ? {
              ELECTRON_CONFIG_CACHE: electronCacheRoot,
              electron_config_cache: electronCacheRoot,
              ELECTRON_CACHE: electronCacheRoot,
              ELECTRON_OVERRIDE_DIST_PATH: electronDistPath,
            }
          : {}),
        ...extraEnv,
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  let exitCode: number | null = null;
  const exitPromise = new Promise<void>((resolveExit) => {
    child.once('exit', () => {
      resolveExit();
    });
  });
  child.on('exit', (code) => {
    exitCode = code;
  });

  await waitFor(() => existsSync(startupLogPath), 30_000);
  await waitFor(() => {
    if (exitCode !== null) {
      const startupLog = existsSync(startupLogPath)
        ? readFileSync(startupLogPath, 'utf8')
        : 'startup.log missing';
      throw new Error(
        `Electron exited before the ready-to-show marker with code ${exitCode}.\n${startupLog}`,
      );
    }

    return readFileSync(startupLogPath, 'utf8').includes(
      'window:ready-to-show',
    );
  }, 30_000);

  await waitForCdpEndpoint(remoteDebuggingPort);
  const versionResponse = await fetch(
    `http://127.0.0.1:${remoteDebuggingPort}/json/version`,
  );
  if (!versionResponse.ok) {
    throw new Error(
      'Electron exposed the CDP port but not the browser target.',
    );
  }

  const version = (await versionResponse.json()) as {
    webSocketDebuggerUrl: string;
  };
  const browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('Electron did not expose a browser context.');
  }

  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  return {
    browser,
    page,
    userDataDir,
    child,
    close: async () => {
      await browser.close().catch(() => {});
      if (!child.killed) {
        child.kill();
      }
      await exitPromise.catch(() => {});
    },
  };
};

export const launchElectronHarness = async (
  options: LaunchElectronHarnessOptions = {},
): Promise<ElectronHarness> => {
  return launchBinaryHarness({
    binaryPath: electronPath,
    launchArgs: ['.vite/build/main.js'],
    userDataDir: options.userDataDir,
    extraEnv: options.extraEnv,
  });
};

export const launchPackagedElectronHarness = async (
  options: LaunchElectronHarnessOptions & { extraEnv?: NodeJS.ProcessEnv } = {},
): Promise<ElectronHarness> => {
  return launchBinaryHarness({
    binaryPath: electronPath,
    launchArgs: [`--app=${resolvePackagedAppAsarPath()}`],
    userDataDir: options.userDataDir,
    extraEnv: options.extraEnv,
    useElectronDevEnv: true,
  });
};

export const runElectronImportFixtureCommand = async ({
  userDataDir,
  fixtureName,
}: ImportFixtureOptions) => {
  await runImportFixtureCommand({
    binaryPath: electronPath,
    launchArgs: ['.vite/build/main.js', `--import-fixture=${fixtureName}`],
    userDataDir,
  });
};

export const runPackagedImportFixtureCommand = async ({
  userDataDir,
  fixtureName,
}: ImportFixtureOptions) => {
  await runImportFixtureCommand({
    binaryPath: electronPath,
    launchArgs: [
      `--app=${resolvePackagedAppAsarPath()}`,
      `--import-fixture=${fixtureName}`,
    ],
    userDataDir,
    useElectronDevEnv: true,
  });
};

const runImportFixtureCommand = async ({
  binaryPath,
  launchArgs,
  userDataDir,
  extraEnv,
  useElectronDevEnv = true,
}: LaunchBinaryHarnessOptions) => {
  const startupLogPath = join(userDataDir, startupLogFileName);
  const child = spawn(
    binaryPath,
    [`--user-data-dir=${userDataDir}`, ...launchArgs],
    {
      env: {
        ...pickEnv([
          'PATH',
          'SystemRoot',
          'WINDIR',
          'TEMP',
          'TMP',
          'APPDATA',
          'LOCALAPPDATA',
          'USERPROFILE',
          'HOME',
          'HOMEDRIVE',
          'HOMEPATH',
          'PROCESSOR_ARCHITECTURE',
          'ComSpec',
        ]),
        INDICOINK_ISOLATED_USER_DATA: '1',
        INDICOINK_USER_DATA_DIR: userDataDir,
        INDICOINK_PERSISTENCE_DB_PATH:
          getIsolatedPersistenceDbPath(userDataDir),
        INDICOINK_DISABLE_GPU: '1',
        INDICOINK_RECORD_LOGGING: '1',
        ...(useElectronDevEnv
          ? {
              ELECTRON_CONFIG_CACHE: electronCacheRoot,
              electron_config_cache: electronCacheRoot,
              ELECTRON_CACHE: electronCacheRoot,
              ELECTRON_OVERRIDE_DIST_PATH: electronDistPath,
            }
          : {}),
        ...extraEnv,
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  const exitPromise = new Promise<void>((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Fixture import command exited with code ${code}.`));
    });
    child.on('error', reject);
  });

  await waitFor(() => existsSync(startupLogPath), 30_000);
  await waitFor(
    () => readFileSync(startupLogPath, 'utf8').includes('fixture-import:done'),
    30_000,
  );

  await exitPromise;
  await wait(5_000);
};
