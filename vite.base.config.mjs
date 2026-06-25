import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

const builtins = [
  'electron',
  ...builtinModules.flatMap((mod) => [mod, `node:${mod}`]),
];
export const external = [
  ...builtins,
  ...Object.keys(packageJson.dependencies || {}),
];

const viteDevServerUrls = {};

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
  const { command, forgeConfig } = env;
  const rendererConfigs = forgeConfig?.renderer?.length
    ? forgeConfig.renderer
    : [{ name: 'main_window' }];
  const names = rendererConfigs
    .filter(({ name }) => name != null)
    .map(({ name }) => name);
  const define = {};

  for (const name of names) {
    const upperName = name.toUpperCase().replaceAll('-', '_');
    const viteDevServerKey = `${upperName}_VITE_DEV_SERVER_URL`;
    const viteNameKey = `${upperName}_VITE_NAME`;

    define[viteDevServerKey] =
      command === 'serve'
        ? JSON.stringify(viteDevServerUrls[viteDevServerKey] ?? '')
        : undefined;
    define[viteNameKey] = JSON.stringify(name);
  }

  return define;
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
  configureServer(server) {
    server.httpServer?.once('listening', () => {
      const address = server.httpServer?.address();
      if (typeof address === 'object' && address && 'port' in address) {
        const upperName = name.toUpperCase().replaceAll('-', '_');
        viteDevServerUrls[`${upperName}_VITE_DEV_SERVER_URL`] =
          `http://localhost:${address.port}`;
      }
    });
  },
});

export default defineConfig({});
