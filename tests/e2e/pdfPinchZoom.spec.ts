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
) => {
  await page
    .locator('.pdf-preview-sheet')
    .first()
    .evaluate(
      (element, event) => {
        element.dispatchEvent(
          new PointerEvent(event.type, {
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
          }),
        );
      },
      { type, pointerId, clientX, clientY, isPrimary },
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
      midpoint.x + 180,
      midpoint.y,
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
    expect(zoomedBox.x + zoomedBox.width * 0.45).toBeCloseTo(midpoint.x, 0);
    expect(zoomedBox.y + zoomedBox.height * 0.35).toBeCloseTo(midpoint.y, 0);

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
      midpoint.x + 180,
      midpoint.y,
      false,
    );

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
  } finally {
    await harness.close().catch(() => {});
  }
});
