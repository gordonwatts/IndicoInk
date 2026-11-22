import { execFile } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export const getLegacySquirrelUninstaller = (
  localAppData: string | undefined,
) => {
  if (!localAppData || !isAbsolute(localAppData)) return;

  const installPath = join(localAppData, 'indicoink');
  const updatePath = join(installPath, 'Update.exe');
  const packagesPath = join(installPath, 'packages');

  if (
    lstatSync(installPath, { throwIfNoEntry: false })?.isDirectory() &&
    lstatSync(packagesPath, { throwIfNoEntry: false })?.isDirectory() &&
    lstatSync(join(packagesPath, 'RELEASES'), {
      throwIfNoEntry: false,
    })?.isFile() &&
    lstatSync(updatePath, { throwIfNoEntry: false })?.isFile()
  ) {
    return updatePath;
  }
  return undefined;
};

export const uninstallLegacySquirrel = async (updatePath: string) => {
  await runFile(updatePath, ['--uninstall'], { windowsHide: true });
};
