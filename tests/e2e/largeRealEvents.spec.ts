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

test('separates Wednesday Energy Frontier session blocks vertically', async () => {
  const harness = await openLiveEvent('https://indico.fnal.gov/event/52465');

  try {
    await harness.page
      .locator('.segmented-control-option', {
        hasText: 'Wednesday, March 30, 2022',
      })
      .click();

    await expect(harness.page.getByText('38 talks shown')).toBeVisible();

    const blockTops = await harness.page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.agenda-session-block--absolute',
        ),
      ]
        .map((block) => Math.round(block.getBoundingClientRect().top))
        .slice(0, 3),
    );

    expect(blockTops).toHaveLength(3);
    expect(blockTops[0]).toBeLessThan(blockTops[1] ?? 0);
    expect(blockTops[1]).toBeLessThan(blockTops[2] ?? 0);
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

    await harness.page
      .locator('.segmented-control-option', {
        hasText: 'Tuesday, September 9, 2025',
      })
      .click();
    await harness.page.waitForTimeout(250);
    await harness.page.evaluate(() => {
      document.querySelector<HTMLElement>('.page-surface')?.scrollTo({
        left: 560,
        behavior: 'auto',
      });
    });
    await harness.page.waitForTimeout(100);

    const widthSamples = await harness.page.evaluate(async () => {
      const readWidths = () => {
        const shell = document.querySelector<HTMLElement>('.agenda-shell-main');
        const gutter = document.querySelector<HTMLElement>(
          '.agenda-time-gutter--absolute',
        );
        const canvas = document.querySelector<HTMLElement>(
          '.agenda-canvas-scroll',
        );
        const session = document.querySelector<HTMLElement>(
          '.agenda-session-block--absolute:not(.agenda-session-block--shared)',
        );
        const gutterRect = gutter?.getBoundingClientRect();
        const sessionRect = session?.getBoundingClientRect();
        const gutterProbeY = Math.max(
          (gutterRect?.top ?? 0) + 12,
          Math.min((sessionRect?.top ?? 0) + 96, window.innerHeight - 12),
        );
        const gutterProbeXs = gutterRect
          ? [
              gutterRect.left + Math.min(24, gutterRect.width / 2),
              gutterRect.right - 4,
            ]
          : [];
        const gutterProbeHitsAgenda = gutterProbeXs.some((x) =>
          Boolean(
            document
              .elementFromPoint(x, gutterProbeY)
              ?.closest('.agenda-session-block, .agenda-talk-card'),
          ),
        );

        return {
          shellWidth: Math.round(shell?.getBoundingClientRect().width ?? 0),
          gutterWidth: Math.round(gutter?.getBoundingClientRect().width ?? 0),
          gutterRight: Math.round(gutter?.getBoundingClientRect().right ?? 0),
          canvasWidth: Math.round(canvas?.getBoundingClientRect().width ?? 0),
          sessionWidth: Math.round(session?.getBoundingClientRect().width ?? 0),
          gutterProbeHitsAgenda,
          viewportWidth: window.innerWidth,
        };
      };
      const samples = [readWidths()];

      for (let index = 0; index < 20; index += 1) {
        await new Promise<void>((resolveFrame) => {
          window.requestAnimationFrame(() => resolveFrame());
        });
        samples.push(readWidths());
      }

      return samples;
    });
    const canvasWidths = widthSamples.map((sample) => sample.canvasWidth);
    const shellWidths = widthSamples.map((sample) => sample.shellWidth);
    const gutterWidths = widthSamples.map((sample) => sample.gutterWidth);
    const gutterRights = widthSamples.map((sample) => sample.gutterRight);
    const sessionWidths = widthSamples.map((sample) => sample.sessionWidth);
    const viewportWidth = widthSamples[0]?.viewportWidth ?? 0;

    expect(
      Math.max(...canvasWidths) - Math.min(...canvasWidths),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.max(...shellWidths) - Math.min(...shellWidths),
    ).toBeLessThanOrEqual(1);
    expect(Math.max(...gutterWidths)).toBeLessThanOrEqual(90);
    expect(
      Math.max(...gutterRights) - Math.min(...gutterRights),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.max(...sessionWidths) - Math.min(...sessionWidths),
    ).toBeLessThanOrEqual(1);
    expect(Math.max(...shellWidths)).toBeGreaterThanOrEqual(
      Math.max(Math.max(...canvasWidths), viewportWidth),
    );
    expect(widthSamples.some((sample) => sample.gutterProbeHitsAgenda)).toBe(
      false,
    );
    expect(Math.max(...canvasWidths)).toBeGreaterThan(viewportWidth);
  } finally {
    await harness.close();
  }
});

test('keeps the ACAT talk-details pane out of the agenda canvas', async () => {
  const harness = await openLiveEvent('https://indico.cern.ch/event/1488410/');

  try {
    await harness.page
      .locator('.segmented-control-option', {
        hasText: 'Tuesday, September 9, 2025',
      })
      .click();
    await harness.page.waitForTimeout(250);

    const geometry = await harness.page.evaluate(() => {
      const canvas = document
        .querySelector('.agenda-canvas-scroll')
        ?.getBoundingClientRect();
      const trackBlocks = [
        ...document.querySelectorAll('.agenda-session-block--absolute'),
      ];
      const trackBlockRects = trackBlocks
        .filter((block) =>
          (block.getAttribute('aria-label') || '').includes('Track'),
        )
        .map((block) => {
          const blockRect = block.getBoundingClientRect();
          const firstCardRect = block
            .querySelector('.agenda-talk-card')
            ?.getBoundingClientRect();

          return {
            title:
              block.querySelector('.agenda-session-block-heading h4')
                ?.textContent ?? '',
            timeRange:
              block.querySelector('.agenda-session-block-heading p')
                ?.textContent ?? '',
            top: Math.round(blockRect.top),
            firstCardTop: Math.round(firstCardRect?.top ?? 0),
            firstCardBottom: Math.round(firstCardRect?.bottom ?? 0),
          };
        });
      const firstTrackBlock = trackBlocks.find((block) =>
        (block.getAttribute('aria-label') || '').includes('Track 1'),
      );
      const firstTrackCard =
        firstTrackBlock?.querySelector('.agenda-talk-card');
      const firstTrackCardRect = firstTrackCard?.getBoundingClientRect();
      const firstTrackCardHit =
        firstTrackCardRect &&
        document.elementFromPoint(
          firstTrackCardRect.left + firstTrackCardRect.width / 2,
          firstTrackCardRect.top + firstTrackCardRect.height / 2,
        );

      return {
        canvasRight: canvas?.right ?? 0,
        marker1430Top:
          [...document.querySelectorAll('.agenda-time-marker')]
            .find((marker) => marker.textContent?.trim() === '14:30')
            ?.getBoundingClientRect().top ?? 0,
        cardLeft: firstTrackCardRect?.left ?? 0,
        cardRight: firstTrackCardRect?.right ?? 0,
        cardTop: firstTrackCardRect?.top ?? 0,
        cardBottom: firstTrackCardRect?.bottom ?? 0,
        viewportBottom: window.innerHeight,
        scrollTop: canvas?.top ?? 0,
        scrollBottom: canvas?.bottom ?? 0,
        firstTrackCardHitIsClickable: Boolean(
          firstTrackCardHit?.closest('.agenda-talk-card'),
        ),
        trackBlockRects,
      };
    });

    expect(geometry.canvasRight).toBeGreaterThan(0);
    expect(geometry.trackBlockRects).toHaveLength(6);
    expect(
      geometry.trackBlockRects.filter((block) =>
        block.title.includes('Track 1'),
      ),
    ).toHaveLength(2);
    expect(
      geometry.trackBlockRects.filter((block) =>
        block.title.includes('Track 2'),
      ),
    ).toHaveLength(2);
    expect(
      geometry.trackBlockRects.filter((block) =>
        block.title.includes('Track 3'),
      ),
    ).toHaveLength(2);
    const firstSlotTrackBlocks = geometry.trackBlockRects.filter((block) =>
      block.timeRange.startsWith('14:30'),
    );
    expect(firstSlotTrackBlocks).toHaveLength(3);
    firstSlotTrackBlocks.forEach((block) => {
      expect(Math.abs(block.top - geometry.marker1430Top)).toBeLessThanOrEqual(
        2,
      );
    });
    expect(geometry.cardLeft).toBeGreaterThan(0);
    expect(geometry.cardRight).toBeLessThan(geometry.canvasRight);
    expect(geometry.cardTop).toBeGreaterThan(geometry.scrollTop);
    expect(geometry.cardTop).toBeLessThan(geometry.viewportBottom);
    expect(geometry.firstTrackCardHitIsClickable).toBe(true);
  } finally {
    await harness.close();
  }
});
