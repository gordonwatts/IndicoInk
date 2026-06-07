import { test, expect } from '@playwright/test';

import { launchElectronHarness } from './electronHarness';

test('launches and closes the Electron app', async () => {
  const harness = await launchElectronHarness();
  const appInfo = await harness.page.evaluate(() =>
    window.indicoInk.getAppInfo(),
  );

  expect(appInfo.appName).toBe('IndicoInk');
  await harness.close();
});
