import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const electronPath = resolve('node_modules/electron/dist/electron.exe');
const electronCacheRoot = resolve('.electron-cache');
const electronDistPath = resolve('node_modules/electron/dist');
const remoteDebuggingPort = 9222;
const pickEnv = (keys: string[]) =>
  Object.fromEntries(
    keys
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

const wait = (milliseconds: number) =>
  new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

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

const waitForCdpEndpoint = async () => {
  const endpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
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
};

export type ImportFixtureOptions = {
  userDataDir: string;
  fixtureName: 'small' | 'large';
};

export const launchElectronHarness = async (
  options: LaunchElectronHarnessOptions = {},
): Promise<ElectronHarness> => {
  const userDataDir =
    options.userDataDir ?? mkdtempSync(resolve(tmpdir(), 'indicoink-e2e-'));
  const startupLogPath = join(userDataDir, 'startup.log');

  const child = spawn(
    electronPath,
    [
      `--remote-debugging-port=${remoteDebuggingPort}`,
      '--disable-gpu',
      '--disable-software-rasterizer',
      `--user-data-dir=${userDataDir}`,
      '.vite/build/main.js',
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
        INDICOINK_DISABLE_GPU: '1',
        ELECTRON_CONFIG_CACHE: electronCacheRoot,
        electron_config_cache: electronCacheRoot,
        ELECTRON_CACHE: electronCacheRoot,
        ELECTRON_OVERRIDE_DIST_PATH: electronDistPath,
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  let exitCode: number | null = null;
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

  await waitForCdpEndpoint();
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${remoteDebuggingPort}`,
  );
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
        child.kill('SIGKILL');
      }
    },
  };
};

export const runElectronImportFixtureCommand = async ({
  userDataDir,
  fixtureName,
}: ImportFixtureOptions) => {
  const startupLogPath = join(userDataDir, 'startup.log');
  const child = spawn(
    electronPath,
    [
      `--user-data-dir=${userDataDir}`,
      '.vite/build/main.js',
      `--import-fixture=${fixtureName}`,
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
        INDICOINK_DISABLE_GPU: '1',
        ELECTRON_CONFIG_CACHE: electronCacheRoot,
        electron_config_cache: electronCacheRoot,
        ELECTRON_CACHE: electronCacheRoot,
        ELECTRON_OVERRIDE_DIST_PATH: electronDistPath,
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
