import { defineConfig } from 'vite';

import { pluginExposeRenderer } from './vite.base.config.mjs';

export default defineConfig((env) => {
  const { root, mode, forgeConfigSelf } = env;
  const name = forgeConfigSelf?.name ?? 'main_window';

  return {
    root,
    mode,
    base: './',
    build: {
      outDir: `.vite/renderer/${name}`,
    },
    plugins: [pluginExposeRenderer(name)],
    resolve: {
      preserveSymlinks: true,
    },
    clearScreen: false,
  };
});
