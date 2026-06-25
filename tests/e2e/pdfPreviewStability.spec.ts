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

test('keeps the talk PDF preview stable after diagnostics are removed', async () => {
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-pdf-stable-'));

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
    await expect(harness.page.getByText('Slides ready.')).toBeVisible({
      timeout: 30_000,
    });
    await harness.page.waitForTimeout(750);

    await harness.page.evaluate(() => {
      const root = document.querySelector('.pdf-preview-pages');
      (
        window as typeof window & {
          __pdfPreviewMutationCount?: number;
          __pdfPreviewStopObserver?: () => void;
        }
      ).__pdfPreviewMutationCount = 0;

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          const target = mutation.target;
          if (
            target instanceof HTMLCanvasElement ||
            (target instanceof HTMLElement &&
              target.classList.contains('pdf-preview-sheet')) ||
            (target instanceof SVGElement &&
              target.classList.contains('pdf-preview-overlay'))
          ) {
            (
              window as typeof window & { __pdfPreviewMutationCount: number }
            ).__pdfPreviewMutationCount += 1;
          }
        }
      });

      if (root) {
        observer.observe(root, {
          attributes: true,
          childList: true,
          subtree: true,
        });
      }

      (
        window as typeof window & { __pdfPreviewStopObserver?: () => void }
      ).__pdfPreviewStopObserver = () => observer.disconnect();
    });

    const samples: Array<{
      stageClientWidth: number;
      stageClientHeight: number;
      firstCanvasWidth: string;
      firstCanvasHeight: string;
    }> = [];
    for (let index = 0; index < 12; index += 1) {
      samples.push(
        await harness.page.evaluate(() => {
          const stage = document.querySelector('.pdf-preview-stage');
          const firstCanvas = document.querySelector<HTMLCanvasElement>(
            '.pdf-preview-canvas',
          );
          return {
            stageClientWidth: stage?.clientWidth ?? 0,
            stageClientHeight: stage?.clientHeight ?? 0,
            firstCanvasWidth: firstCanvas?.style.width ?? '',
            firstCanvasHeight: firstCanvas?.style.height ?? '',
          };
        }),
      );
      await harness.page.waitForTimeout(250);
    }

    const mutationCount = await harness.page.evaluate(() => {
      const state = window as typeof window & {
        __pdfPreviewMutationCount?: number;
        __pdfPreviewStopObserver?: () => void;
      };
      state.__pdfPreviewStopObserver?.();
      return state.__pdfPreviewMutationCount ?? 0;
    });
    const uniqueSamples = new Set(
      samples.map((sample) => JSON.stringify(sample)),
    );

    expect(mutationCount).toBe(0);
    expect(uniqueSamples.size).toBe(1);
  } finally {
    await harness.close().catch(() => {});
  }
});
