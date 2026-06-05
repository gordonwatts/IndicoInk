import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

if (!existsSync(binaryPath)) {
  throw new Error(
    `Electron binary not found at ${binaryPath}. Reinstall dependencies with \`npm install --cache .npm-cache\`.`,
  );
}

const currentPath = existsSync(pathFile) ? readFileSync(pathFile, 'utf8').trim() : '';

if (currentPath !== win32Binary) {
  writeFileSync(pathFile, `${win32Binary}\n`, 'utf8');
}
