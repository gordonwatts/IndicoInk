import {
  _electron as electron,
  expect,
  type ElectronApplication,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { getIsolatedPersistenceDbPath } from '../../src/runtimeModes';
import { resolvePackagedAppAsarPath } from './electronHarness';

type WindowState = {
  bounds: { x: number; y: number; width: number; height: number };
  isMaximized: boolean;
  isFullScreen: boolean;
  primaryWorkArea: { x: number; y: number; width: number; height: number };
  workAreas: Array<{ x: number; y: number; width: number; height: number }>;
};

const readWindowState = (application: ElectronApplication) =>
  application.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      throw new Error('The main window is unavailable.');
    }

    return {
      bounds: window.getBounds(),
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen(),
      primaryWorkArea: screen.getPrimaryDisplay().workArea,
      workAreas: screen.getAllDisplays().map(({ workArea }) => workArea),
    };
  }) as Promise<WindowState>;

const closeApplication = async (application: ElectronApplication) => {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  const closed = application.waitForEvent('close');
  await application.evaluate(({ app }) => app.quit());
  await closed;
};

const launchApp = async (
  userDataDir: string,
  packaged: boolean,
): Promise<ElectronApplication> => {
  const args = [`--user-data-dir=${userDataDir}`];
  if (packaged) {
    args.push(`--app=${resolvePackagedAppAsarPath()}`);
  } else {
    args.push('.vite/build/main.js');
  }

  return electron.launch({
    executablePath: resolve('node_modules/electron/dist/electron.exe'),
    cwd: process.cwd(),
    args,
    env: {
      ...process.env,
      INDICOINK_ISOLATED_USER_DATA: '1',
      INDICOINK_USER_DATA_DIR: userDataDir,
      INDICOINK_PERSISTENCE_DB_PATH: getIsolatedPersistenceDbPath(userDataDir),
      INDICOINK_DISABLE_GPU: '1',
      INDICOINK_RECORD_LOGGING: '1',
      ELECTRON_CONFIG_CACHE: resolve('.electron-cache'),
      electron_config_cache: resolve('.electron-cache'),
      ELECTRON_CACHE: resolve('.electron-cache'),
      ELECTRON_OVERRIDE_DIST_PATH: resolve('node_modules/electron/dist'),
    },
  });
};

export const verifyWindowStatePersistence = async (packaged = false) => {
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-window-state-'));
  let application: ElectronApplication | null = null;

  try {
    application = await launchApp(userDataDir, packaged);
    await application.firstWindow();
    const firstRun = await readWindowState(application);
    expect(firstRun.bounds.width).toBe(
      Math.min(1280, firstRun.primaryWorkArea.width),
    );
    expect(firstRun.bounds.height).toBe(
      Math.min(900, firstRun.primaryWorkArea.height),
    );

    const resizedBounds = { x: 80, y: 70, width: 1000, height: 700 };
    await application.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows()[0]?.setBounds(bounds);
    }, resizedBounds);
    await expect
      .poll(async () => (await readWindowState(application!)).bounds)
      .toMatchObject(resizedBounds);
    await closeApplication(application);

    application = await launchApp(userDataDir, packaged);
    await application.firstWindow();
    expect(await readWindowState(application)).toMatchObject({
      bounds: resizedBounds,
      isMaximized: false,
      isFullScreen: false,
    });

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setFullScreen(true);
    });
    await expect
      .poll(async () => (await readWindowState(application!)).isFullScreen)
      .toBe(true);

    await closeApplication(application);

    application = await launchApp(userDataDir, packaged);
    await application.firstWindow();
    await expect
      .poll(async () => (await readWindowState(application!)).isFullScreen)
      .toBe(true);

    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setFullScreen(false);
      window?.setBounds({ x: 5000, y: 5000, width: 1000, height: 700 });
    });
    await closeApplication(application);

    application = await launchApp(userDataDir, packaged);
    await application.firstWindow();
    const restoredAfterDisplayChange = await readWindowState(application);
    expect(
      restoredAfterDisplayChange.workAreas.some((workArea) => {
        const bounds = restoredAfterDisplayChange.bounds;
        return (
          bounds.x < workArea.x + workArea.width &&
          bounds.x + bounds.width > workArea.x &&
          bounds.y < workArea.y + workArea.height &&
          bounds.y + bounds.height > workArea.y
        );
      }),
    ).toBe(true);
  } finally {
    if (application) {
      await closeApplication(application);
    }
    rmSync(userDataDir, { recursive: true, force: true });
  }
};
