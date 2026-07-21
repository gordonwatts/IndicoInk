import { expect, test, type Page } from '@playwright/test';
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

const dispatchTouchPointer = async (
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  pointerId: number,
  clientX: number,
  clientY: number,
  isPrimary: boolean,
  timeStamp?: number,
) => {
  await page
    .locator('.pdf-preview-sheet')
    .first()
    .evaluate(
      (element, event) => {
        const pointerEvent = new PointerEvent(event.type, {
          bubbles: true,
          cancelable: true,
          pointerId: event.pointerId,
          pointerType: 'touch',
          isPrimary: event.isPrimary,
          button: event.type === 'pointerup' ? 0 : 0,
          buttons: event.type === 'pointerup' ? 0 : 1,
          clientX: event.clientX,
          clientY: event.clientY,
          pressure: event.type === 'pointerup' ? 0 : 0.5,
        });
        if (event.timeStamp !== undefined) {
          Object.defineProperty(pointerEvent, 'timeStamp', {
            configurable: true,
            value: event.timeStamp,
          });
        }
        element.dispatchEvent(pointerEvent);
      },
      { type, pointerId, clientX, clientY, isPrimary, timeStamp },
    );
};

const prepareSmallFixtureTalk = async () => {
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-pinch-zoom-'));
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

  return { userDataDir };
};

test('pinch zooms around the midpoint and clamps to fit-to-width', async () => {
  const { userDataDir } = await prepareSmallFixtureTalk();
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
    await expect(
      harness.page.getByRole('button', { name: 'Home' }),
    ).toBeVisible();
    await expect(
      harness.page.locator('.pdf-preview-sheet').first(),
    ).toBeVisible();
    await expect(
      harness.page.locator('.pdf-preview-pages.is-rendering'),
    ).toHaveCount(0);

    const initialCanvasWidth = await harness.page
      .locator('.pdf-preview-canvas')
      .first()
      .evaluate((canvas) => (canvas as HTMLCanvasElement).width);

    await harness.page.evaluate(() => {
      const prototype = HTMLElement.prototype as HTMLElement & {
        setPointerCapture?: (pointerId: number) => void;
        hasPointerCapture?: (pointerId: number) => boolean;
        releasePointerCapture?: (pointerId: number) => void;
      };
      prototype.setPointerCapture = () => {};
      prototype.hasPointerCapture = () => false;
      prototype.releasePointerCapture = () => {};
    });

    const initialBox = await harness.page
      .locator('.pdf-preview-sheet')
      .first()
      .boundingBox();
    if (!initialBox) {
      throw new Error('The PDF sheet was not visible for pinch testing.');
    }

    const midpoint = {
      x: initialBox.x + initialBox.width * 0.45,
      y: initialBox.y + initialBox.height * 0.35,
    };
    const first = { x: midpoint.x - 60, y: midpoint.y };
    const second = { x: midpoint.x + 60, y: midpoint.y };
    const movedSecond = { x: midpoint.x + 180, y: midpoint.y };

    await dispatchTouchPointer(
      harness.page,
      'pointerdown',
      101,
      first.x,
      first.y,
      true,
    );
    await dispatchTouchPointer(
      harness.page,
      'pointerdown',
      102,
      second.x,
      second.y,
      false,
    );
    await dispatchTouchPointer(
      harness.page,
      'pointermove',
      102,
      movedSecond.x,
      movedSecond.y,
      false,
    );

    await expect(harness.page.getByText('200%')).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await harness.page
              .locator('.pdf-preview-sheet')
              .first()
              .boundingBox()
          )?.width ?? 0,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(initialBox.width * 1.5);
    await expect(
      harness.page.locator('.pdf-preview-pages.is-rendering'),
    ).toHaveCount(0);
    await harness.page.waitForTimeout(250);

    const zoomedBox = await harness.page
      .locator('.pdf-preview-sheet')
      .first()
      .boundingBox();
    if (!zoomedBox) {
      throw new Error('The zoomed PDF sheet was not visible.');
    }
    const movedMidpoint = {
      x: (first.x + movedSecond.x) / 2,
      y: (first.y + movedSecond.y) / 2,
    };
    expect(zoomedBox.x + zoomedBox.width * 0.45).toBeCloseTo(
      movedMidpoint.x,
      0,
    );
    expect(zoomedBox.y + zoomedBox.height * 0.35).toBeCloseTo(
      movedMidpoint.y,
      0,
    );

    await harness.page.evaluate((expectedFocalPoint) => {
      const canvases = Array.from(
        document.querySelectorAll<HTMLCanvasElement>('.pdf-preview-canvas'),
      );
      const samples = canvases.map((canvas) => {
        const context = canvas.getContext('2d');
        if (!context) {
          return null;
        }
        for (let row = 1; row < 10; row += 1) {
          for (let column = 1; column < 10; column += 1) {
            const x = Math.floor((canvas.width * column) / 10);
            const y = Math.floor((canvas.height * row) / 10);
            if (context.getImageData(x, y, 1, 1).data[3] !== 0) {
              return { x, y };
            }
          }
        }
        return null;
      });
      const monitor = {
        active: true,
        disruptionFrameCount: 0,
      };
      (
        window as typeof window & {
          __pdfPinchRenderMonitor?: typeof monitor;
        }
      ).__pdfPinchRenderMonitor = monitor;

      const watchForBlankFrames = () => {
        const currentCanvases = Array.from(
          document.querySelectorAll<HTMLCanvasElement>('.pdf-preview-canvas'),
        );
        const pages = document.querySelector<HTMLElement>('.pdf-preview-pages');
        const anchoredPage =
          document.querySelector<HTMLElement>('.pdf-preview-sheet');
        const anchoredPageBox = anchoredPage?.getBoundingClientRect();
        const focalPointDrifted =
          !anchoredPageBox ||
          Math.abs(
            anchoredPageBox.left +
              anchoredPageBox.width * 0.45 -
              expectedFocalPoint.x,
          ) > 4 ||
          Math.abs(
            anchoredPageBox.top +
              anchoredPageBox.height * 0.35 -
              expectedFocalPoint.y,
          ) > 4;
        const hasBlankCanvas = currentCanvases.some((canvas, index) => {
          const sample = samples[index];
          const context = canvas.getContext('2d');
          return (
            sample !== null &&
            (!context ||
              context.getImageData(sample.x, sample.y, 1, 1).data[3] === 0)
          );
        });
        if (
          hasBlankCanvas ||
          currentCanvases.length !== canvases.length ||
          !pages ||
          Number.parseFloat(getComputedStyle(pages).opacity) < 0.99 ||
          focalPointDrifted
        ) {
          monitor.disruptionFrameCount += 1;
        }
        if (monitor.active) {
          window.requestAnimationFrame(watchForBlankFrames);
        }
      };
      window.requestAnimationFrame(watchForBlankFrames);
    }, movedMidpoint);

    await dispatchTouchPointer(
      harness.page,
      'pointerup',
      101,
      first.x,
      first.y,
      true,
    );
    await dispatchTouchPointer(
      harness.page,
      'pointerup',
      102,
      movedSecond.x,
      movedSecond.y,
      false,
    );
    await expect
      .poll(
        () =>
          harness.page
            .locator('.pdf-preview-canvas')
            .first()
            .evaluate((canvas) => (canvas as HTMLCanvasElement).width),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(initialCanvasWidth * 1.5);
    const disruptionFrameCount = await harness.page.evaluate(() => {
      const monitor = (
        window as typeof window & {
          __pdfPinchRenderMonitor?: {
            active: boolean;
            disruptionFrameCount: number;
          };
        }
      ).__pdfPinchRenderMonitor;
      if (!monitor) {
        throw new Error('The pinch render monitor was not installed.');
      }
      monitor.active = false;
      return monitor.disruptionFrameCount;
    });
    expect(disruptionFrameCount).toBe(0);

    const secondPinchMidpoint = {
      x: midpoint.x,
      y: midpoint.y,
    };
    await dispatchTouchPointer(
      harness.page,
      'pointerdown',
      201,
      secondPinchMidpoint.x - 100,
      secondPinchMidpoint.y,
      true,
    );
    await dispatchTouchPointer(
      harness.page,
      'pointerdown',
      202,
      secondPinchMidpoint.x + 100,
      secondPinchMidpoint.y,
      false,
    );
    await dispatchTouchPointer(
      harness.page,
      'pointermove',
      202,
      secondPinchMidpoint.x - 75,
      secondPinchMidpoint.y,
      false,
    );

    await expect(harness.page.getByText('100%')).toBeVisible();
    await expect(
      harness.page.locator('.pdf-preview-pages.is-rendering'),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await harness.page
              .locator('.pdf-preview-sheet')
              .first()
              .boundingBox()
          )?.width ?? 0,
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(initialBox.width - 4);
    await dispatchTouchPointer(
      harness.page,
      'pointerup',
      201,
      secondPinchMidpoint.x - 100,
      secondPinchMidpoint.y,
      true,
    );
    await dispatchTouchPointer(
      harness.page,
      'pointerup',
      202,
      secondPinchMidpoint.x - 75,
      secondPinchMidpoint.y,
      false,
    );
    await expect
      .poll(() =>
        harness.page
          .locator('.pdf-preview-pages')
          .evaluate((element) => getComputedStyle(element).transform),
      )
      .toBe('none');
  } finally {
    await harness.close().catch(() => {});
  }
});

test('a quick touch pan continues moving after release', async () => {
  const { userDataDir } = await prepareSmallFixtureTalk();
  const harness = await launchElectronHarness({ userDataDir });

  try {
    await harness.page
      .getByRole('button', { name: 'Open IndicoInk Small Event 2026' })
      .click();
    await harness.page
      .getByRole('button', {
        name: 'Open talk for Designing a calm note-taking workflow',
      })
      .click();
    await expect(
      harness.page.locator('.pdf-preview-sheet').first(),
    ).toBeVisible();
    await expect(
      harness.page.locator('.pdf-preview-pages.is-rendering'),
    ).toHaveCount(0);

    await harness.page.evaluate(() => {
      const prototype = HTMLElement.prototype as HTMLElement & {
        setPointerCapture?: (pointerId: number) => void;
        hasPointerCapture?: (pointerId: number) => boolean;
        releasePointerCapture?: (pointerId: number) => void;
      };
      prototype.setPointerCapture = () => {};
      prototype.hasPointerCapture = () => false;
      prototype.releasePointerCapture = () => {};
    });

    const sheet = harness.page.locator('.pdf-preview-sheet').first();
    const box = await sheet.boundingBox();
    if (!box) {
      throw new Error('The PDF sheet was not visible for touch testing.');
    }
    const x = box.x + box.width / 2;
    const startY = box.y + Math.min(240, box.height * 0.7);
    const initialScrollTop = await harness.page
      .locator('.page-surface')
      .evaluate((element) => element.scrollTop);

    await dispatchTouchPointer(
      harness.page,
      'pointerdown',
      301,
      x,
      startY,
      true,
      1,
    );
    await dispatchTouchPointer(
      harness.page,
      'pointermove',
      301,
      x,
      startY - 80,
      true,
      40,
    );
    await dispatchTouchPointer(
      harness.page,
      'pointermove',
      301,
      x,
      startY - 180,
      true,
      80,
    );
    await dispatchTouchPointer(
      harness.page,
      'pointerup',
      301,
      x,
      startY - 180,
      true,
      90,
    );

    const immediateScrollTop = await harness.page
      .locator('.page-surface')
      .evaluate((element) => element.scrollTop);
    expect(immediateScrollTop).toBeGreaterThan(initialScrollTop);
    await expect
      .poll(
        () =>
          harness.page
            .locator('.page-surface')
            .evaluate((element) => element.scrollTop),
        { timeout: 2_000 },
      )
      .toBeGreaterThan(immediateScrollTop + 5);
    await harness.page.waitForTimeout(1_200);
  } finally {
    await harness.close().catch(() => {});
  }
});

test('toolbar zoom scales the PDF without resizing its viewport', async () => {
  const { userDataDir } = await prepareSmallFixtureTalk();
  const harness = await launchElectronHarness({ userDataDir });

  try {
    await harness.page
      .getByRole('button', { name: 'Open IndicoInk Small Event 2026' })
      .click();
    await harness.page
      .getByRole('button', {
        name: 'Open talk for Designing a calm note-taking workflow',
      })
      .click();
    await expect(
      harness.page.getByRole('button', { name: 'Zoom in' }),
    ).toBeVisible();
    await expect(
      harness.page.locator('.pdf-preview-pages.is-rendering'),
    ).toHaveCount(0);

    const page = harness.page.locator('.pdf-preview-sheet').first();
    const stage = harness.page.locator('.pdf-preview-stage');
    const talkStatusStrip = harness.page.locator('.slides-view-controls');
    await expect
      .poll(async () => (await page.boundingBox())?.width ?? 0)
      .toBeGreaterThan(100);
    const initialPageBox = await page.boundingBox();
    const initialStageBox = await stage.boundingBox();
    const initialStatusStripBox = await talkStatusStrip.boundingBox();
    if (!initialPageBox || !initialStageBox || !initialStatusStripBox) {
      throw new Error(
        'The PDF preview was not visible for toolbar zoom testing.',
      );
    }
    const initialSurfaceMetrics = await harness.page
      .locator('.page-surface')
      .evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowX: getComputedStyle(element).overflowX,
        scrollLeft: element.scrollLeft,
      }));

    await harness.page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(harness.page.getByText('115%')).toBeVisible();
    await expect
      .poll(async () => (await page.boundingBox())?.width ?? 0)
      .toBeGreaterThan(initialPageBox.width * 1.1);

    const finalStageBox = await stage.boundingBox();
    const finalStatusStripBox = await talkStatusStrip.boundingBox();
    const finalSurfaceMetrics = await harness.page
      .locator('.page-surface')
      .evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowX: getComputedStyle(element).overflowX,
        scrollLeft: element.scrollLeft,
      }));
    expect(finalSurfaceMetrics).toEqual(initialSurfaceMetrics);
    expect(finalStageBox?.width ?? 0).toBeCloseTo(initialStageBox.width, 0);
    expect(finalStatusStripBox?.x ?? 0).toBeCloseTo(
      initialStatusStripBox.x,
      0,
    );
    expect(finalStatusStripBox?.width ?? 0).toBeCloseTo(
      initialStatusStripBox.width,
      0,
    );

    await harness.page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(harness.page.getByText('100%')).toBeVisible();
    await expect
      .poll(async () => (await page.boundingBox())?.width ?? 0)
      .toBeCloseTo(initialPageBox.width, 0);
    await expect
      .poll(() =>
        harness.page
          .locator('.page-surface')
          .evaluate((element) => element.scrollLeft),
      )
      .toBe(initialSurfaceMetrics.scrollLeft);
    const restoredStatusStripBox = await talkStatusStrip.boundingBox();
    expect(restoredStatusStripBox?.x ?? 0).toBeCloseTo(
      initialStatusStripBox.x,
      0,
    );
    expect(restoredStatusStripBox?.width ?? 0).toBeCloseTo(
      initialStatusStripBox.width,
      0,
    );
  } finally {
    await harness.close().catch(() => {});
  }
});
