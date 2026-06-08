import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { launchElectronHarness } from './electronHarness';

test('opens a public Indico event and reopens it after restart', async () => {
  const userDataDir = mkdtempSync(
    resolve(tmpdir(), 'indicoink-public-import-'),
  );

  const firstApp = await launchElectronHarness({ userDataDir });

  await firstApp.page
    .getByRole('textbox', { name: 'Event URL' })
    .fill('https://indico.in2p3.fr/event/40025');
  await firstApp.page.getByRole('button', { name: 'Open event' }).click();

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
