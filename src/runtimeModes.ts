import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const getIsolatedUserDataPath = (appName: string) =>
  process.env.INDICOINK_USER_DATA_DIR?.trim() ||
  join(tmpdir(), `${appName}-user-data`);

export const shouldUseIsolatedUserData = () =>
  process.env.INDICOINK_ISOLATED_USER_DATA === '1';

export const shouldDisableGpu = () => process.env.INDICOINK_DISABLE_GPU === '1';
