import { defineConfig, mergeConfig } from 'vite';

import {
  external,
  getBuildConfig,
  getBuildDefine,
  pluginHotRestart,
} from './vite.base.config.mjs';

export default defineConfig((env) => {
  const { forgeConfigSelf } = env;
  const entry = forgeConfigSelf?.entry ?? 'src/main.ts';
  const define = getBuildDefine(env);

  const config = {
    build: {
      lib: {
        entry,
        fileName: () => '[name].js',
        formats: ['cjs'],
      },
      rollupOptions: { external },
    },
    plugins: [pluginHotRestart('restart')],
    define,
    resolve: {
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
  };

  return mergeConfig(getBuildConfig(env), config);
});
