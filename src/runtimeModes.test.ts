import { afterEach, describe, expect, it } from 'vitest';

import {
  getIsolatedUserDataPath,
  shouldDisableGpu,
  shouldUseIsolatedUserData,
} from './runtimeModes';

const originalEnv = {
  INDICOINK_DISABLE_GPU: process.env.INDICOINK_DISABLE_GPU,
  INDICOINK_ISOLATED_USER_DATA: process.env.INDICOINK_ISOLATED_USER_DATA,
  INDICOINK_USER_DATA_DIR: process.env.INDICOINK_USER_DATA_DIR,
};

afterEach(() => {
  process.env.INDICOINK_DISABLE_GPU = originalEnv.INDICOINK_DISABLE_GPU;
  process.env.INDICOINK_ISOLATED_USER_DATA =
    originalEnv.INDICOINK_ISOLATED_USER_DATA;
  process.env.INDICOINK_USER_DATA_DIR = originalEnv.INDICOINK_USER_DATA_DIR;
});

describe('runtime modes', () => {
  it('uses an isolated user data directory by default helper path', () => {
    delete process.env.INDICOINK_USER_DATA_DIR;

    expect(getIsolatedUserDataPath('IndicoInk')).toContain(
      'IndicoInk-user-data',
    );
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
