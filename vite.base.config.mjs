import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

import packageJson from './package.json' with { type: 'json' };

const builtins = [
  'electron',
  ...builtinModules.flatMap((mod) => [mod, `node:${mod}`]),
];
export const external = [
  ...builtins,
  ...Object.keys(packageJson.dependencies || {}),
];

export const getBuildConfig = (env) => {
  const { root, mode, command } = env;
  return {
    root,
    mode,
    build: {
      emptyOutDir: false,
      outDir: '.vite/build',
      watch: command === 'serve' ? {} : null,
      minify: command === 'build',
    },
    clearScreen: false,
  };
};

export const getBuildDefine = (env) => {
  void env;
  return {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(
      process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL || '',
    ),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  };
};

export const pluginHotRestart = (event) => ({
  name: 'forge-plugin-hot-restart',
  configureServer(server) {
    const name = server.config.name ?? 'main_window';
    process.viteDevServers ||= {};
    process.viteDevServers[name] = server;
    server.httpServer?.once('listening', () => {
      const address = server.httpServer?.address();
      if (typeof address === 'object' && address && 'port' in address) {
        process.env[`${name.toUpperCase()}_VITE_DEV_SERVER_URL`] =
          `http://localhost:${address.port}`;
      }
    });
    server.watcher.on('change', () => {
      if (event === 'restart') {
        server.ws.send({ type: 'full-reload' });
      } else {
        server.ws.send({ type: 'full-reload' });
      }
    });
  },
});

export const pluginExposeRenderer = (name) => ({
  name: 'forge-plugin-expose-renderer',
  config() {
    return {
      build: {
        rollupOptions: {
          input: {
            [name]: 'index.html',
          },
        },
      },
    };
  },
});

export default defineConfig({});
