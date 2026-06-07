import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const electronCacheRoot = resolve('.electron-cache');
const electronDistPath = resolve('node_modules/electron/dist');

export default async function globalSetup() {
  const buildEnv = {
    ...process.env,
    ELECTRON_CONFIG_CACHE: electronCacheRoot,
    electron_config_cache: electronCacheRoot,
    ELECTRON_CACHE: electronCacheRoot,
    ELECTRON_OVERRIDE_DIST_PATH: electronDistPath,
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
  const mainJsName = assetNames.find(
    (name) => name.startsWith('main_window-') && name.endsWith('.js'),
  );
  const cssName = assetNames.find(
    (name) => name.startsWith('main_window-') && name.endsWith('.css'),
  );
  const workerName = assetNames.find(
    (name) => name.startsWith('pdf.worker.min-') && name.endsWith('.mjs'),
  );

  if (!mainJsName || !cssName || !workerName) {
    throw new Error('Renderer build did not produce the expected assets.');
  }

  if (!indexHtml.includes('./assets/')) {
    throw new Error('Renderer index did not resolve bundled assets.');
  }

  const mainJs = readFileSync(resolve(assetsDir, mainJsName), 'utf8');
  if (!mainJs.includes('pdf.worker.min-')) {
    throw new Error('Renderer main bundle did not reference the worker asset.');
  }
}
