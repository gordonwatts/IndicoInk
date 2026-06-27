import { join } from 'node:path';

export const getIsolatedUserDataPath = (appName: string) =>
  process.env.INDICOINK_USER_DATA_DIR?.trim() ||
  join(
    process.env.LOCALAPPDATA?.trim() ||
      process.env.APPDATA?.trim() ||
      process.cwd(),
    appName,
  );

export const getPersistenceDbPath = (userDataPath: string) =>
  process.env.INDICOINK_PERSISTENCE_DB_PATH?.trim() ||
  join(userDataPath, 'indicoink-persistence.sqlite3');

export const getIsolatedPersistenceDbPath = (userDataPath: string) =>
  join(userDataPath, 'history', 'indicoink-persistence.sqlite3');

export const shouldUseIsolatedUserData = () =>
  process.env.INDICOINK_ISOLATED_USER_DATA === '1';

export const shouldDisableGpu = () => process.env.INDICOINK_DISABLE_GPU === '1';
