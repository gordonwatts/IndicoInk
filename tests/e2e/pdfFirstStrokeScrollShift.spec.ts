import { expect, test } from '@playwright/test';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createConferenceId,
  createDeckId,
  createTalkId,
} from '../../src/persistenceModels';
import {
  launchElectronHarness,
  runElectronImportFixtureCommand,
} from './electronHarness';

test.describe.configure({ timeout: 120_000 });

test('keeps the PDF roll stable on the first drawing mouse down', async () => {
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-first-stroke-'));

  await runElectronImportFixtureCommand({
    userDataDir,
    fixtureName: 'small',
  });

  const conferenceSourceUrl =
    'https://small.indico.example.org/event/indicoink-small-2026';
  const conferenceId = createConferenceId(conferenceSourceUrl);
  const talkContributionId = 'small-1001';
  const deckSourceUrl =
    'https://small.indico.example.org/event/indicoink-small-2026/materials/small-1001-slides.pdf';
  const talkId = createTalkId(conferenceId, talkContributionId);
  const deckId = createDeckId(talkId, deckSourceUrl);
  const cacheFilePath = resolve(
    userDataDir,
    'deck-cache',
    conferenceId,
    `${deckId}.pdf`,
  );
  mkdirSync(dirname(cacheFilePath), { recursive: true });
  copyFileSync(resolve('tests/fixtures/pdfs/multi-page.pdf'), cacheFilePath);

  const harness = await launchElectronHarness({ userDataDir });

  try {
    await harness.page
      .getByRole('button', { name: 'Open IndicoInk Small Event 2026' })
      .click();

    await expect(
      harness.page.getByRole('heading', { name: 'Event agenda' }),
    ).toBeVisible();

    await harness.page
      .getByRole('button', {
        name: 'Open details for Designing a calm note-taking workflow',
      })
      .click();

    await harness.page.getByRole('button', { name: 'Open slides' }).click();

    await expect(
      harness.page.getByRole('heading', {
        name: 'Designing a calm note-taking workflow',
      }),
    ).toBeVisible();
    const targetPage = harness.page.locator('.pdf-preview-page').nth(2);
    const targetSheet = targetPage.locator('.pdf-preview-sheet');
    await expect(targetSheet).toBeVisible();
    await expect
      .poll(
        async () =>
          targetSheet.evaluate(
            (element) => element.getBoundingClientRect().width,
          ),
        {
          timeout: 30_000,
        },
      )
      .toBeGreaterThan(0);
    await harness.page.getByRole('button', { name: 'Pen' }).click();
    await harness.page.getByRole('button', { name: 'Draw' }).click();
    await targetPage.scrollIntoViewIfNeeded();

    const before = await harness.page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>('.page-surface');
      const preview = document.querySelector<HTMLElement>('.pdf-preview');
      const stage = document.querySelector<HTMLElement>('.pdf-preview-stage');
      const sheet =
        document.querySelectorAll<HTMLElement>('.pdf-preview-sheet')[2];
      return {
        surfaceScrollTop: surface?.scrollTop ?? 0,
        previewTop: preview?.getBoundingClientRect().top ?? 0,
        stageTop: stage?.getBoundingClientRect().top ?? 0,
        sheetTop: sheet?.getBoundingClientRect().top ?? 0,
      };
    });

    const box = await targetSheet.boundingBox();
    if (!box) {
      throw new Error('PDF sheet was not visible for the diagnostic draw.');
    }

    await harness.page.mouse.move(
      box.x + box.width * 0.25,
      box.y + box.height * 0.35,
    );
    await harness.page.mouse.down();
    await harness.page.waitForTimeout(100);

    const afterDown = await harness.page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>('.page-surface');
      const preview = document.querySelector<HTMLElement>('.pdf-preview');
      const stage = document.querySelector<HTMLElement>('.pdf-preview-stage');
      const sheet =
        document.querySelectorAll<HTMLElement>('.pdf-preview-sheet')[2];
      return {
        surfaceScrollTop: surface?.scrollTop ?? 0,
        previewTop: preview?.getBoundingClientRect().top ?? 0,
        stageTop: stage?.getBoundingClientRect().top ?? 0,
        sheetTop: sheet?.getBoundingClientRect().top ?? 0,
      };
    });

    await harness.page.mouse.up();

    expect(afterDown.surfaceScrollTop).toBeCloseTo(before.surfaceScrollTop, 1);
    expect(afterDown.previewTop).toBeCloseTo(before.previewTop, 1);
    expect(afterDown.stageTop).toBeCloseTo(before.stageTop, 1);
    expect(afterDown.sheetTop).toBeCloseTo(before.sheetTop, 1);
  } finally {
    await harness.close().catch(() => {});
  }
});
