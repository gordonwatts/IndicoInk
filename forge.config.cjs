const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const electronCacheRoot = join(__dirname, '.electron-cache');
const electronZipDir = existsSync(electronCacheRoot)
  ? readdirSync(electronCacheRoot, {
      withFileTypes: true,
    }).find((entry) => entry.isDirectory())?.name
  : undefined;

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    electronZipDir: electronZipDir
      ? join(electronCacheRoot, electronZipDir)
      : undefined,
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-squirrel', config: { noMsi: true } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-deb', config: {} },
    { name: '@electron-forge/maker-rpm', config: {} },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          { entry: 'src/main.ts', config: 'vite.main.config.mjs' },
          { entry: 'src/preload.ts', config: 'vite.preload.config.mjs' },
        ],
        renderer: [{ name: 'main_window', config: 'vite.renderer.config.mjs' }],
      },
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
