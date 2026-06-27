import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { expect, test } from '@playwright/test';

import { launchElectronHarness } from './electronHarness';

const apiKeyFile = process.env.INDICOINK_TEST_API_KEY_FILE?.trim();

test.skip(
  !apiKeyFile,
  'Set INDICOINK_TEST_API_KEY_FILE to run the live CERN auth check.',
);

test('opens a CERN event with an API key from a local secret file', async () => {
  if (!apiKeyFile) {
    throw new Error('INDICOINK_TEST_API_KEY_FILE is required.');
  }

  const apiKey = (await readFile(apiKeyFile, 'utf8')).trim();
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-cern-auth-'));
  const harness = await launchElectronHarness({ userDataDir });

  try {
    await harness.page
      .getByRole('textbox', { name: 'Event URL' })
      .fill('https://indico.cern.ch/event/1649690/');
    await harness.page.getByRole('button', { name: 'Open event' }).click();

    const privateEventPrompt = harness.page.getByRole('heading', {
      name: 'Private event',
    });
    const agendaHeading = harness.page.getByRole('heading', {
      name: 'Event agenda',
    });

    await expect(privateEventPrompt.or(agendaHeading)).toBeVisible({
      timeout: 30_000,
    });

    if (await privateEventPrompt.isVisible()) {
      await harness.page.getByLabel('API key').fill(apiKey);
      await harness.page.getByRole('button', { name: 'Save key' }).click();
    }

    await expect(agendaHeading).toBeVisible({ timeout: 30_000 });
  } finally {
    await harness.close();
  }
});
