import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const electronDir = join(process.cwd(), 'node_modules', 'electron');
const pathFile = join(electronDir, 'path.txt');
const win32Binary = 'electron.exe';

if (!existsSync(electronDir)) {
  throw new Error(
    'Electron is not installed. Run `npm install --cache .npm-cache` before starting the app.',
  );
}

const distDir = join(electronDir, 'dist');
const binaryPath = join(distDir, win32Binary);
const installScript = join(electronDir, 'install.js');
const electronVersion = JSON.parse(
  readFileSync(join(electronDir, 'package.json'), 'utf8'),
).version;
const electronPlatform =
  process.env.ELECTRON_INSTALL_PLATFORM ??
  process.env.npm_config_platform ??
  process.platform;
const electronArch =
  process.env.ELECTRON_INSTALL_ARCH ??
  process.env.npm_config_arch ??
  process.arch;
const electronCache = join(process.cwd(), '.electron-cache');

if (!existsSync(binaryPath)) {
  if (!existsSync(installScript)) {
    throw new Error(
      `Electron binary not found at ${binaryPath}, and ${installScript} is missing. Reinstall dependencies with \`npm install --cache .npm-cache\`.`,
    );
  }

  const installResult = spawnSync(process.execPath, [installScript], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_CACHE: '.electron-cache',
      ELECTRON_CONFIG_CACHE: '.electron-cache',
      electron_config_cache: '.electron-cache',
    },
  });

  if (
    installResult.status === 0 &&
    !existsSync(binaryPath) &&
    process.platform === 'win32'
  ) {
    const cachedZip = findCachedElectronZip(electronCache);

    if (cachedZip) {
      rmSync(distDir, { recursive: true, force: true });

      const extractCommand = `Expand-Archive -LiteralPath '${escapePowerShellPath(
        cachedZip,
      )}' -DestinationPath '${escapePowerShellPath(distDir)}' -Force`;
      const extractResult = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-Command', extractCommand],
        {
          stdio: 'inherit',
        },
      );

      if (extractResult.status === 0) {
        writeFileSync(pathFile, win32Binary, 'utf8');
      }
    }
  }

  if (installResult.status !== 0 || !existsSync(binaryPath)) {
    throw new Error(
      `Electron binary not found at ${binaryPath}. Reinstall dependencies with \`npm install --cache .npm-cache\`.`,
    );
  }
}

const expectedPathFile = win32Binary;
const currentPathFile = existsSync(pathFile)
  ? readFileSync(pathFile, 'utf8')
  : '';
const currentPath = currentPathFile.replace(/^\uFEFF/, '').trim();

if (currentPath !== win32Binary || currentPathFile !== expectedPathFile) {
  writeFileSync(pathFile, expectedPathFile, 'utf8');
}

function findCachedElectronZip(directory) {
  if (!existsSync(directory)) {
    return undefined;
  }

  const expectedZip = `electron-v${electronVersion}-${electronPlatform}-${electronArch}.zip`;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isFile() && entry.name === expectedZip) {
      return entryPath;
    }

    if (entry.isDirectory()) {
      const nestedZip = findCachedElectronZip(entryPath);

      if (nestedZip) {
        return nestedZip;
      }
    }
  }

  return undefined;
}

function escapePowerShellPath(path) {
  return path.replaceAll("'", "''");
}
