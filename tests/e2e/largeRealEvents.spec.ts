import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { launchElectronHarness } from './electronHarness';

test.describe.configure({ timeout: 120_000 });

async function openLiveEvent(eventUrl: string) {
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-live-event-'));
  const harness = await launchElectronHarness({ userDataDir });

  await harness.page.getByRole('textbox', { name: 'Event URL' }).fill(eventUrl);
  await harness.page.getByRole('button', { name: 'Open event' }).click();

  await expect(
    harness.page.getByRole('heading', { name: 'Event agenda' }),
  ).toBeVisible({ timeout: 90_000 });

  return harness;
}

test('renders the FNAL Energy Frontier workshop talks', async () => {
  const harness = await openLiveEvent('https://indico.fnal.gov/event/52465');

  try {
    await expect(
      harness.page.getByRole('heading', { name: 'Energy Frontier Workshop' }),
    ).toBeVisible();
    await expect(harness.page.getByText('14 talks shown')).toBeVisible();
    await expect(
      harness.page.locator('.agenda-talk-card-title').filter({
        hasText: 'Welcome and Introduction',
      }),
    ).toBeVisible();
    await expect(
      harness.page.locator('.agenda-talk-card-title').filter({
        hasText: 'EF01 and EF02 Contributions',
      }),
    ).toBeVisible();
    await expect(
      harness.page.locator('.agenda-talk-card-title').filter({
        hasText: 'Circular e+e- collider physics + FCC-ee developments',
      }),
    ).toBeVisible();
    await expect(harness.page.locator('.agenda-talk-card-title')).toHaveCount(
      14,
    );
  } finally {
    await harness.close();
  }
});

test('renders the ACAT 2025 parallel-session agenda', async () => {
  const harness = await openLiveEvent('https://indico.cern.ch/event/1488410/');

  try {
    await expect(harness.page.getByText('89 talks shown')).toBeVisible();
    await expect(
      harness.page
        .locator('.agenda-talk-card-title')
        .filter({ hasText: 'Opening' }),
    ).toBeVisible();
    await expect(
      harness.page.locator('.agenda-talk-card-title').filter({
        hasText:
          'Advances in Model-Agnostic Searches for New Physics at the Large Hadron Collider',
      }),
    ).toBeVisible();
    await expect(
      harness.page.locator('.agenda-talk-card-title').filter({
        hasText:
          'A web-based job and data management system for the HERD experiment',
      }),
    ).toBeVisible();
    await expect(harness.page.locator('.agenda-talk-card-title')).toHaveCount(
      89,
    );
  } finally {
    await harness.close();
  }
});
