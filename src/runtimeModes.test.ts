import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getIsolatedUserDataPath,
  shouldDisableGpu,
  shouldUseIsolatedUserData,
} from './runtimeModes';

const originalEnv = {
  INDICOINK_DISABLE_GPU: process.env.INDICOINK_DISABLE_GPU,
  INDICOINK_ISOLATED_USER_DATA: process.env.INDICOINK_ISOLATED_USER_DATA,
  INDICOINK_USER_DATA_DIR: process.env.INDICOINK_USER_DATA_DIR,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  APPDATA: process.env.APPDATA,
};

beforeEach(() => {
  process.env.LOCALAPPDATA = 'C:\\Users\\Test\\AppData\\Local';
  process.env.APPDATA = 'C:\\Users\\Test\\AppData\\Roaming';
});

afterEach(() => {
  process.env.INDICOINK_DISABLE_GPU = originalEnv.INDICOINK_DISABLE_GPU;
  process.env.INDICOINK_ISOLATED_USER_DATA =
    originalEnv.INDICOINK_ISOLATED_USER_DATA;
  process.env.INDICOINK_USER_DATA_DIR = originalEnv.INDICOINK_USER_DATA_DIR;
  process.env.LOCALAPPDATA = originalEnv.LOCALAPPDATA;
  process.env.APPDATA = originalEnv.APPDATA;
});

describe('runtime modes', () => {
  it('uses the standard local app data directory by default helper path', () => {
    delete process.env.INDICOINK_USER_DATA_DIR;

    expect(getIsolatedUserDataPath('IndicoInk')).toContain(
      'C:\\Users\\Test\\AppData\\Local',
    );
    expect(getIsolatedUserDataPath('IndicoInk')).toMatch(/IndicoInk$/);
  });

  it('uses the explicit user data directory override when provided', () => {
    process.env.INDICOINK_USER_DATA_DIR = 'C:\\tmp\\indicoink-dev-user-data';

    expect(getIsolatedUserDataPath('IndicoInk')).toBe(
      'C:\\tmp\\indicoink-dev-user-data',
    );
  });

  it('only enables the launch modes when the matching env vars are set', () => {
    delete process.env.INDICOINK_DISABLE_GPU;
    delete process.env.INDICOINK_ISOLATED_USER_DATA;

    expect(shouldDisableGpu()).toBe(false);
    expect(shouldUseIsolatedUserData()).toBe(false);

    process.env.INDICOINK_DISABLE_GPU = '1';
    process.env.INDICOINK_ISOLATED_USER_DATA = '1';

    expect(shouldDisableGpu()).toBe(true);
    expect(shouldUseIsolatedUserData()).toBe(true);
  });
});
