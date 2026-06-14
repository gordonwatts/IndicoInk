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

    const geometry = await harness.page.evaluate(() => {
      const canvas = document
        .querySelector('.agenda-canvas-scroll')
        ?.getBoundingClientRect();
      const panel = document
        .querySelector('.agenda-talk-detail-panel')
        ?.getBoundingClientRect();
      const trackBlocks = [
        ...document.querySelectorAll('.agenda-session-block--absolute'),
      ];
      const firstTrackBlock = trackBlocks.find((block) =>
        (block.getAttribute('aria-label') || '').includes('Track 1'),
      );
      const firstTrackCard =
        firstTrackBlock?.querySelector('.agenda-talk-card');
      const firstTrackCardRect = firstTrackCard?.getBoundingClientRect();

      return {
        canvasRight: canvas?.right ?? 0,
        panelLeft: panel?.left ?? 0,
        cardTop: firstTrackCardRect?.top ?? 0,
        cardBottom: firstTrackCardRect?.bottom ?? 0,
        scrollTop: canvas?.top ?? 0,
        scrollBottom: canvas?.bottom ?? 0,
      };
    });

    expect(geometry.canvasRight).toBeLessThan(geometry.panelLeft);
    expect(geometry.cardTop).toBeGreaterThan(geometry.scrollTop);
    expect(geometry.cardBottom).toBeLessThan(geometry.scrollBottom);
  } finally {
    await harness.close();
  }
});
