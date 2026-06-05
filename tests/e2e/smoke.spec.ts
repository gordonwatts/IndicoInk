import { _electron as electron, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('launches and closes the Electron app', async () => {
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

  const rendererDir = resolve('.vite/renderer/main_window');
  const assetsDir = resolve(rendererDir, 'assets');
  const indexHtml = readFileSync(resolve(rendererDir, 'index.html'), 'utf8');
  const assetNames = readdirSync(assetsDir);
  const mainJsName = assetNames.find((name) => name.startsWith('main_window-') && name.endsWith('.js'));
  const cssName = assetNames.find((name) => name.startsWith('main_window-') && name.endsWith('.css'));
  const workerName = assetNames.find((name) => name.startsWith('pdf.worker.min-') && name.endsWith('.mjs'));

  test.expect(mainJsName).toBeTruthy();
  test.expect(cssName).toBeTruthy();
  test.expect(workerName).toBeTruthy();
  test.expect(indexHtml).toContain('./assets/');
  test.expect(indexHtml).not.toContain('http://localhost');
  test.expect(indexHtml).not.toContain('D:\\Code\\llm\\IndicoInk');

  const mainJs = readFileSync(resolve(assetsDir, mainJsName as string), 'utf8');
  test.expect(mainJs).toContain('pdf.worker.min-');
  test.expect(mainJs).not.toContain('http://localhost');
  test.expect(mainJs).not.toContain('D:\\Code\\llm\\IndicoInk');

  const app = await electron.launch({
    executablePath: resolve('node_modules/electron/dist/electron.exe'),
    args: ['.vite/build/main.js'],
    env: {
      ...process.env,
      ELECTRON_CONFIG_CACHE: 'D:\\Code\\llm\\IndicoInk\\.electron-cache',
      electron_config_cache: 'D:\\Code\\llm\\IndicoInk\\.electron-cache',
      ELECTRON_CACHE: 'D:\\Code\\llm\\IndicoInk\\.electron-cache',
    },
  });
  await app.evaluate(({ app }) => app.quit());
  await app.close();
});
