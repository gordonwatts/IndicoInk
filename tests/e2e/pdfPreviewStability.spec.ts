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

    await expect(harness.page.getByRole('heading', { level: 1 })).toBeVisible();

    await harness.page
      .getByRole('button', {
        name: 'Open talk for Designing a calm note-taking workflow',
      })
      .click();

    await harness.page.evaluate(() => {
      const state = window as typeof window & {
        __pdfPreviewVisibleIncompleteFrames?: number;
        __pdfPreviewStopFrameWatch?: () => void;
      };
      state.__pdfPreviewVisibleIncompleteFrames = 0;

      let frameId = 0;
      const watchFrame = () => {
        const pages = document.querySelector<HTMLElement>('.pdf-preview-pages');
        const canvases = Array.from(
          document.querySelectorAll<HTMLCanvasElement>('.pdf-preview-canvas'),
        );
        const visiblePageRoll =
          pages &&
          !pages.classList.contains('is-rendering') &&
          window.getComputedStyle(pages).visibility !== 'hidden';
        const incompleteCanvases =
          canvases.length === 0 ||
          canvases.some(
            (canvas) => !canvas.style.width || !canvas.style.height,
          );
        const loadingCaptions = document.body.textContent?.includes('Loading');

        if (visiblePageRoll && (incompleteCanvases || loadingCaptions)) {
          state.__pdfPreviewVisibleIncompleteFrames =
            (state.__pdfPreviewVisibleIncompleteFrames ?? 0) + 1;
        }

        frameId = window.requestAnimationFrame(watchFrame);
      };

      frameId = window.requestAnimationFrame(watchFrame);
      state.__pdfPreviewStopFrameWatch = () => {
        window.cancelAnimationFrame(frameId);
      };
    });
    await expect(harness.page.getByRole('button', { name: 'Home' })).toBeVisible(
      { timeout: 30_000 },
    );
    await expect(
      harness.page.getByRole('heading', { name: 'Slide Notes' }),
    ).toHaveCount(0);
    await harness.page.waitForTimeout(750);
    const firstCanvasBox = await harness.page
      .locator('.pdf-preview-canvas')
      .first()
      .boundingBox();
    expect(firstCanvasBox).not.toBeNull();
    expect(firstCanvasBox?.y ?? 0).toBeLessThan(720);

    await harness.page.evaluate(() => {
      const pageSurface = document.querySelector<HTMLElement>('.page-surface');
      if (!pageSurface) {
        return;
      }

      pageSurface.scrollTop = Math.max(pageSurface.scrollTop, 680);
      pageSurface.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await harness.page.waitForTimeout(100);

    const stickyToolbarSample = await harness.page.evaluate(() => {
      const pageSurface = document.querySelector<HTMLElement>('.page-surface');
      const toolbar = document.querySelector<HTMLElement>('.pdf-preview-toolbar');
      const pageSurfaceBox = pageSurface?.getBoundingClientRect();
      const toolbarBox = toolbar?.getBoundingClientRect();

      return {
        pageSurfaceTop: pageSurfaceBox?.top ?? 0,
        toolbarTop: toolbarBox?.top ?? 0,
        toolbarHeight: toolbarBox?.height ?? 0,
        scrollTop: pageSurface?.scrollTop ?? 0,
      };
    });
    expect(stickyToolbarSample.scrollTop).toBeGreaterThan(0);
    expect(
      Math.abs(stickyToolbarSample.toolbarTop - stickyToolbarSample.pageSurfaceTop),
    ).toBeLessThanOrEqual(4);
    expect(stickyToolbarSample.toolbarHeight).toBeLessThanOrEqual(48);

    await harness.page.getByRole('button', { name: 'Home' }).click();
    await harness.page.waitForFunction(() => {
      const pageSurface = document.querySelector<HTMLElement>('.page-surface');
      return (pageSurface?.scrollTop ?? 0) === 0;
    });

    const visibleIncompleteFrames = await harness.page.evaluate(() => {
      const state = window as typeof window & {
        __pdfPreviewVisibleIncompleteFrames?: number;
        __pdfPreviewStopFrameWatch?: () => void;
      };
      state.__pdfPreviewStopFrameWatch?.();
      return state.__pdfPreviewVisibleIncompleteFrames ?? 0;
    });

    const samples: Array<{
      stageClientWidth: number;
      stageClientHeight: number;
      stageScrollHeight: number;
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
            stageScrollHeight: stage?.scrollHeight ?? 0,
            firstCanvasWidth: firstCanvas?.style.width ?? '',
            firstCanvasHeight: firstCanvas?.style.height ?? '',
          };
        }),
      );
      await harness.page.waitForTimeout(250);
    }

    const uniqueSamples = new Set(
      samples.map((sample) => JSON.stringify(sample)),
    );

    expect(visibleIncompleteFrames).toBe(0);
    expect(uniqueSamples.size).toBe(1);
    expect(samples[0]?.stageScrollHeight).toBe(samples[0]?.stageClientHeight);
  } finally {
    await harness.close().catch(() => {});
  }
});
