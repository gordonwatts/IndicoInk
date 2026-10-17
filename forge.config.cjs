const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const electronCacheRoot = join(__dirname, '.electron-cache');
const installerIcon = join(__dirname, 'assets', 'icons', 'indicoink.ico');
const msixAssets = join(__dirname, 'assets', 'msix');
const msixPublisher = process.env.INDICOINK_MSIX_PUBLISHER?.trim();
const msixCertificate = process.env.INDICOINK_MSIX_CERTIFICATE?.trim();
const msixCertificatePassword = process.env.INDICOINK_MSIX_CERTIFICATE_PASSWORD;
const msixPackageVersion = process.env.INDICOINK_MSIX_VERSION?.trim();

if (Boolean(msixPublisher) !== Boolean(msixCertificate)) {
  throw new Error(
    'MSIX release signing requires both INDICOINK_MSIX_PUBLISHER and INDICOINK_MSIX_CERTIFICATE.',
  );
}
const electronZipDir = existsSync(electronCacheRoot)
  ? readdirSync(electronCacheRoot, {
      withFileTypes: true,
    }).find((entry) => entry.isDirectory())?.name
  : undefined;

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    icon: installerIcon,
    electronZipDir: electronZipDir
      ? join(electronCacheRoot, electronZipDir)
      : undefined,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-msix',
      config: {
        packageAssets: msixAssets,
        sign: true,
        windowsKitVersion: '10.0.26100.0',
        manifestVariables: {
          packageIdentity: 'IndicoInk',
          packageDisplayName: 'IndicoInk',
          appDisplayName: 'IndicoInk',
          publisher: msixPublisher || 'CN=IndicoInk Development',
          publisherDisplayName: 'IndicoInk',
          ...(msixPackageVersion
            ? { packageVersion: msixPackageVersion }
            : {}),
          packageBackgroundColor: '#FFFFFF',
          packageMinOSVersion: '10.0.19041.0',
          packageMaxOSVersionTested: '10.0.26100.0',
        },
        windowsSignOptions: msixCertificate
          ? {
              certificateFile: msixCertificate,
              certificatePassword: msixCertificatePassword,
            }
          : undefined,
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
