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
    const agendaHeading = harness.page.getByRole('heading', { level: 1 });

    await expect(privateEventPrompt).toBeVisible({ timeout: 30_000 });

    await harness.page.getByLabel('API key').fill(apiKey);
    await harness.page.getByRole('button', { name: 'Save key' }).click();
    await harness.page
      .getByLabel('API key')
      .fill('')
      .catch(() => {});

    const legacyScopeError = harness.page
      .getByText(
        'This API token needs Indico legacy API read access before this event can be opened.',
      )
      .first();

    await expect(agendaHeading.or(legacyScopeError)).toBeVisible({
      timeout: 30_000,
    });

    if (await legacyScopeError.isVisible()) {
      test.skip(
        true,
        'The local CERN token lacks Indico legacy API read access.',
      );
    }

    await expect(
      harness.page.getByRole('heading', { name: 'Untitled Indico event' }),
    ).toHaveCount(0);

    await harness.page
      .getByRole('button', { name: 'Slides available' })
      .click();
    await harness.page
      .getByRole('button', { name: /^Open talk for / })
      .first()
      .click();

    const slidesReady = harness.page.getByText(/1 \/ \d+ slides/);
    const fileScopeError = harness.page
      .getByText(
        'This API token needs additional Indico file access before this slide deck can be opened.',
      )
      .first();

    await expect(slidesReady.or(fileScopeError)).toBeVisible({
      timeout: 30_000,
    });

    if (await fileScopeError.isVisible()) {
      test.skip(
        true,
        'The local CERN token lacks Indico file attachment access.',
      );
    }
  } finally {
    await harness.close();
  }
});
