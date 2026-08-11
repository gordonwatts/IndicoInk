import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { launchElectronHarness } from './electronHarness';

const readLocalOpenAiApiKey = () => {
  const envPath = resolve('.env.local');
  if (!existsSync(envPath)) {
    return null;
  }
  const match = readFileSync(envPath, 'utf8').match(
    /^OPENAI_API_KEY\s*=\s*(.+)$/m,
  );
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') || null;
};

test.skip(
  process.env.INDICOINK_RUN_LIVE_WEB_AGENDA !== '1',
  'Opt-in local-only OpenAI and IAIFI smoke test.',
);
test.setTimeout(300_000);

test('extracts the live IAIFI summer workshop agenda', async () => {
  const apiKey = readLocalOpenAiApiKey();
  if (!apiKey) {
    throw new Error('No OPENAI_API_KEY is available in .env.local.');
  }

  const harness = await launchElectronHarness({
    userDataDir: mkdtempSync(resolve(tmpdir(), 'indicoink-live-web-agenda-')),
  });
  try {
    await harness.page
      .getByLabel('Event URL')
      .fill('https://iaifi.org/summer-workshop.html');
    await harness.page.getByRole('button', { name: 'Open event' }).click();
    await harness.page.getByLabel('OpenAI API key').fill(apiKey ?? '');
    await harness.page
      .getByRole('button', { name: 'Save and continue' })
      .click();

    await expect(harness.page.locator('.agenda-talk-card').first()).toBeVisible(
      {
        timeout: 240_000,
      },
    );
    expect(
      await harness.page.locator('.agenda-talk-card').count(),
    ).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});
