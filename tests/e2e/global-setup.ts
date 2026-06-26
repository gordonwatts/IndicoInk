import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

const electronCacheRoot = resolve('.electron-cache');
const electronDistPath = resolve('node_modules/electron/dist');

export default async function globalSetup() {
  const [
    { default: mainConfig },
    { default: preloadConfig },
    { default: rendererConfig },
  ] = await Promise.all([
    import('../../vite.main.config.mjs'),
    import('../../vite.preload.config.mjs'),
    import('../../vite.renderer.config.mjs'),
  ]);

  const buildEnv = {
    command: 'build' as const,
    mode: 'production',
    root: process.cwd(),
    ...process.env,
    ELECTRON_CONFIG_CACHE: electronCacheRoot,
    electron_config_cache: electronCacheRoot,
    ELECTRON_CACHE: electronCacheRoot,
    ELECTRON_OVERRIDE_DIST_PATH: electronDistPath,
  };

  await build(mainConfig(buildEnv));
  await build(preloadConfig(buildEnv));
  await build(rendererConfig(buildEnv));

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
