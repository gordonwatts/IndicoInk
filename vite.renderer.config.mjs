import { defineConfig } from 'vite';

import {
  pluginExposeRenderer,
  runtimeWatchIgnored,
} from './vite.base.config.mjs';

export default defineConfig((env) => {
  const { root, mode, forgeConfigSelf } = env;
  const name = forgeConfigSelf?.name ?? 'main_window';

  return {
    root,
    mode,
    base: './',
    build: {
      outDir: `.vite/renderer/${name}`,
      target: 'es2022',
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'es2022',
      },
    },
    plugins: [pluginExposeRenderer(name)],
    resolve: {
      preserveSymlinks: true,
    },
    server: {
      watch: {
        ignored: runtimeWatchIgnored,
      },
    },
    clearScreen: false,
  };
});
