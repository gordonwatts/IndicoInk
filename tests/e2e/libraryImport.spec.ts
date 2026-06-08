import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  launchElectronHarness,
  runElectronImportFixtureCommand,
} from './electronHarness';

test('imports a fixture event and shows it after restart', async () => {
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-import-'));

  await runElectronImportFixtureCommand({
    userDataDir,
    fixtureName: 'small',
  });

  const harness = await launchElectronHarness({ userDataDir });

  const row = harness.page.getByRole('button', {
    name: 'Open IndicoInk Small Event 2026',
  });

  await expect(row).toBeVisible();
  await expect(
    harness.page.getByText('June 12, 2026', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    harness.page.getByText('small.indico.example.org', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(harness.page.getByText('6 annotated slides')).toBeVisible();
  await expect(harness.page.getByText('Cached for offline use')).toBeVisible();

  await row.click();

  await expect(
    harness.page.getByRole('heading', {
      name: 'Event agenda',
    }),
  ).toBeVisible();
  await expect(
    harness.page.getByRole('heading', {
      name: 'IndicoInk Small Event 2026',
    }),
  ).toBeVisible();

  await harness.close();
});
