import { defineConfig } from 'vite';

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
    resolve: {
      preserveSymlinks: true,
    },
    clearScreen: false,
  };
});
