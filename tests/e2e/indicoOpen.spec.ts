import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  launchElectronHarness,
  runElectronOpenEventUrlCommand,
} from './electronHarness';

test('opens a public Indico event and reopens it after restart', async () => {
  const userDataDir = mkdtempSync(
    resolve(tmpdir(), 'indicoink-public-import-'),
  );

  const firstApp = await launchElectronHarness({
    userDataDir,
    launchArgs: ['https://indico.in2p3.fr/event/40025'],
  });

  await expect(
    firstApp.page.getByRole('heading', {
      name: 'DIRAC Project meeting',
    }),
  ).toBeVisible({ timeout: 60_000 });

  await firstApp.page.getByRole('button', { name: 'Back to library' }).click();
  await expect(
    firstApp.page.getByRole('heading', { name: 'Open an event', level: 1 }),
  ).toBeVisible();

  await runElectronOpenEventUrlCommand({
    userDataDir,
    eventUrl: 'https://indico.in2p3.fr/event/40025',
  });
  await expect(
    firstApp.page.getByRole('heading', {
      name: 'DIRAC Project meeting',
    }),
  ).toBeVisible({ timeout: 60_000 });

  await firstApp.close();

  const secondApp = await launchElectronHarness({ userDataDir });

  const reopenedRow = secondApp.page.getByRole('button', {
    name: 'Open DIRAC Project meeting',
  });

  await expect(reopenedRow).toBeVisible({ timeout: 30_000 });
  await reopenedRow.click();

  await expect(
    secondApp.page.getByRole('heading', {
      name: 'DIRAC Project meeting',
    }),
  ).toBeVisible();

  await secondApp.close();
});
