import { _electron as electron, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('launches and closes the Electron app', async () => {
  const userDataDir = mkdtempSync(`${tmpdir()}\\indicoink-user-data-`);
  const buildEnv = {
    ...process.env,
    ELECTRON_CONFIG_CACHE: 'D:\\Code\\llm\\IndicoInk\\.electron-cache',
    electron_config_cache: 'D:\\Code\\llm\\IndicoInk\\.electron-cache',
    ELECTRON_CACHE: 'D:\\Code\\llm\\IndicoInk\\.electron-cache',
  };

  execSync('npx vite build --config vite.main.config.mjs', {
    stdio: 'inherit',
    env: buildEnv,
  });
  execSync('npx vite build --config vite.preload.config.mjs', {
    stdio: 'inherit',
    env: buildEnv,
  });
  execSync('npx vite build --config vite.renderer.config.mjs', {
    stdio: 'inherit',
    env: buildEnv,
  });

  const app = await electron.launch({
    executablePath: resolve('node_modules/electron/dist/electron.exe'),
    args: ['--disable-gpu', '.vite/build/main.js'],
    env: {
      ...process.env,
      ELECTRON_CONFIG_CACHE: 'D:\\Code\\llm\\IndicoInk\\.electron-cache',
      electron_config_cache: 'D:\\Code\\llm\\IndicoInk\\.electron-cache',
      ELECTRON_CACHE: 'D:\\Code\\llm\\IndicoInk\\.electron-cache',
      APPDATA: userDataDir,
      LOCALAPPDATA: userDataDir,
      TEMP: userDataDir,
      TMP: userDataDir,
    },
  });

  await app.close();
});
