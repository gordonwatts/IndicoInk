import { defineConfig, mergeConfig } from 'vite';

import {
  external,
  getBuildConfig,
  pluginHotRestart,
} from './vite.base.config.mjs';

export default defineConfig((env) => {
  const { forgeConfigSelf } = env;
  const entry = forgeConfigSelf?.entry ?? 'src/preload.ts';

  const config = {
    build: {
      rollupOptions: {
        external,
        input: entry,
        output: {
          format: 'cjs',
          inlineDynamicImports: true,
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
        },
      },
    },
    plugins: [pluginHotRestart('reload')],
  };

  return mergeConfig(getBuildConfig(env), config);
});
