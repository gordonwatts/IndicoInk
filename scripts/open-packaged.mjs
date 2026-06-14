import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const electronExe = resolve('node_modules/electron/dist/electron.exe');
const packagedAppAsar = resolve('out/indicoink-win32-x64/resources/app.asar');

if (!existsSync(electronExe)) {
  throw new Error(
    `Electron was not found at ${electronExe}. Run npm install first.`,
  );
}

if (!existsSync(packagedAppAsar)) {
  throw new Error(
    `Packaged app.asar was not found at ${packagedAppAsar}. Run npm run package first.`,
  );
}

const child = spawn(
  electronExe,
  [...process.argv.slice(2), `--app=${packagedAppAsar}`],
  {
    stdio: 'inherit',
    windowsHide: false,
    env: {
      ...process.env,
      ELECTRON_OVERRIDE_DIST_PATH: resolve('node_modules/electron/dist'),
    },
  },
);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
