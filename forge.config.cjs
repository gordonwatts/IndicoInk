const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const getCliArch = () => {
  const archArg = process.argv.find(
    (arg) => arg === '--arch' || arg.startsWith('--arch='),
  );

  if (!archArg) {
    return undefined;
  }

  if (archArg.includes('=')) {
    return archArg.split('=', 2)[1];
  }

  const archArgIndex = process.argv.indexOf(archArg);
  return process.argv[archArgIndex + 1];
};

const targetArch =
  getCliArch() ||
  process.env.ELECTRON_INSTALL_ARCH ||
  process.env.npm_config_arch ||
  process.arch;

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        noMsi: true,
        setupExe: `IndicoInk-Setup-${targetArch}.exe`,
      },
    },
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
