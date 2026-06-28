import { expect, test } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { copyFileSync, mkdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { Page } from '@playwright/test';

import {
  createConferenceId,
  createDeckId,
  createTalkId,
} from '../../src/persistenceModels';
import {
  launchElectronHarness,
  runElectronImportFixtureCommand,
} from './electronHarness';

async function openLargeAgenda() {
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-agenda-'));

  await runElectronImportFixtureCommand({
    userDataDir,
    fixtureName: 'large',
  });

  const harness = await launchElectronHarness({ userDataDir });

  await harness.page
    .getByRole('button', {
      name: 'Open IndicoInk Grand Symposium 2026',
    })
    .click();

  await expect(
    harness.page.getByRole('heading', {
      name: 'Event agenda',
    }),
  ).toBeVisible();
  await expect(harness.page.getByLabel('Agenda day canvas')).toBeVisible();

  return harness;
}

async function openLargeAgendaWithCachedDeck() {
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-agenda-perf-'));

  await runElectronImportFixtureCommand({
    userDataDir,
    fixtureName: 'large',
  });

  const conferenceSourceUrl =
    'https://symposium.indico.example.org/event/indicoink-2026';
  const conferenceId = createConferenceId(conferenceSourceUrl);
  const talkContributionId = 'large-1001';
  const deckSourceUrl =
    'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1001-slides.pdf';
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

  await harness.page
    .getByRole('button', {
      name: 'Open IndicoInk Grand Symposium 2026',
    })
    .click();

  await expect(
    harness.page.getByRole('heading', {
      name: 'Event agenda',
    }),
  ).toBeVisible();
  await expect(harness.page.getByLabel('Agenda day canvas')).toBeVisible();

  return harness;
}

async function collectAgendaMetrics(page: Page) {
  return page.evaluate(() => {
    const canvasViewport = document.querySelector<HTMLElement>(
      '.agenda-canvas-scroll',
    );
    const gutter = document.querySelector<HTMLElement>(
      '.agenda-time-gutter--absolute',
    );
    const sessionBlock = document.querySelector<HTMLElement>(
      '.agenda-session-block--absolute:not(.agenda-session-block--shared)',
    );
    const sharedBlock = document.querySelector<HTMLElement>(
      '.agenda-session-block--shared',
    );

    const scrollWidth = canvasViewport?.getBoundingClientRect().width ?? 0;
    const gutterWidth = gutter?.getBoundingClientRect().width ?? 0;
    const sessionWidth = sessionBlock?.getBoundingClientRect().width ?? 0;
    const sharedWidth = sharedBlock?.getBoundingClientRect().width ?? 0;
    const visibleSessionColumns =
      sessionWidth > 0 ? (scrollWidth - gutterWidth) / sessionWidth : 0;

    const sessions = [
      ...document.querySelectorAll<HTMLElement>(
        '.agenda-session-block--absolute',
      ),
    ].map((session) => {
      const sessionRect = session.getBoundingClientRect();
      const cards = [
        ...session.querySelectorAll<HTMLElement>('.agenda-talk-placement'),
      ].map((card) => {
        const rect = card.getBoundingClientRect();
        const articleRect = card
          .querySelector<HTMLElement>('.agenda-talk-card')
          ?.getBoundingClientRect();
        return {
          title:
            card
              .querySelector('.agenda-talk-card-title')
              ?.textContent?.trim() ?? 'Untitled talk',
          top: Math.round(rect.top - sessionRect.top),
          bottom: Math.round(rect.bottom - sessionRect.top),
          visualBottom: Math.round(
            (articleRect ?? rect).bottom - sessionRect.top,
          ),
        };
      });
      const overlaps = cards.flatMap((card, index) => {
        const previous = cards[index - 1];
        if (!previous || card.top >= previous.bottom - 1) {
          return [];
        }

        return [
          {
            previous: previous.title,
            current: card.title,
            previousBottom: previous.bottom,
            currentTop: card.top,
          },
        ];
      });

      return {
        label: session.getAttribute('aria-label') ?? 'Unnamed session',
        cards,
        overlaps,
      };
    });

    const markerTops = [
      ...document.querySelectorAll<HTMLElement>(
        '.agenda-time-marker--absolute',
      ),
    ].map((marker) => marker.getBoundingClientRect().top);
    const markerRegressions = markerTops.flatMap((top, index) => {
      const previous = markerTops[index - 1];
      if (previous === undefined || top > previous) {
        return [];
      }

      return [{ index, previous, top }];
    });

    return {
      scrollWidth,
      gutterWidth,
      sessionWidth,
      sharedWidth,
      visibleSessionColumns,
      overlaps: sessions.flatMap((session) =>
        session.overlaps.map((overlap) => ({
          session: session.label,
          ...overlap,
        })),
      ),
      cardOverflows: sessions.flatMap((session) =>
        session.cards.flatMap((card) => {
          if (card.visualBottom <= card.bottom + 1) {
            return [];
          }

          return [
            {
              session: session.label,
              title: card.title,
              bottom: card.bottom,
              visualBottom: card.visualBottom,
            },
          ];
        }),
      ),
      markerRegressions,
      firstTalkMeta:
        document
          .querySelector('.agenda-talk-card-meta')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim() ?? '',
    };
  });
}

test('renders agenda canvas cards without same-column overlap', async () => {
  const harness = await openLargeAgenda();

  try {
    await harness.page.setViewportSize({ width: 1220, height: 900 });

    await harness.page
      .getByLabel('Agenda day canvas')
      .screenshot({ path: 'test-results/agenda-canvas-layout.png' });
    await harness.page.locator('.page-surface').evaluate((element) => {
      element.scrollTop = 920;
    });
    await harness.page
      .getByLabel('Agenda day canvas')
      .screenshot({ path: 'test-results/agenda-canvas-layout-scrolled.png' });

    await expect(harness.page.locator('.agenda-canvas-scroll')).toHaveCSS(
      'overflow-y',
      'visible',
    );
    await expect(harness.page.locator('.page-surface')).toHaveCSS(
      'overflow-y',
      'auto',
    );

    const layoutReport = await collectAgendaMetrics(harness.page);

    expect(layoutReport.overlaps).toEqual([]);
    expect(layoutReport.markerRegressions).toEqual([]);
    expect(layoutReport.firstTalkMeta).toContain('PDF');
    expect(layoutReport.firstTalkMeta).toContain('annotated slide');
  } finally {
    await harness.close();
  }
});

test('adapts agenda columns across wide and portrait layouts', async () => {
  const harness = await openLargeAgenda();

  try {
    await harness.page.setViewportSize({ width: 1400, height: 900 });
    const wideMetrics = await collectAgendaMetrics(harness.page);

    await harness.page.setViewportSize({ width: 820, height: 1080 });
    const portraitMetrics = await collectAgendaMetrics(harness.page);

    expect(wideMetrics.visibleSessionColumns).toBeGreaterThanOrEqual(2);
    expect(wideMetrics.sharedWidth).toBeGreaterThanOrEqual(
      wideMetrics.sessionWidth * 2,
    );
    expect(portraitMetrics.visibleSessionColumns).toBeGreaterThan(1);
    expect(portraitMetrics.visibleSessionColumns).toBeLessThanOrEqual(2.2);
    expect(portraitMetrics.sharedWidth).toBeGreaterThanOrEqual(
      portraitMetrics.sessionWidth * 2,
    );
  } finally {
    await harness.close();
  }
});

test('keeps agenda controls reachable by keyboard and names status indicators', async () => {
  const harness = await openLargeAgenda();

  try {
    await harness.page.setViewportSize({ width: 1220, height: 900 });
    await harness.page.locator('body').click({ position: { x: 12, y: 12 } });

    const focusOrder: string[] = [];
    for (let index = 0; index < 14; index += 1) {
      await harness.page.keyboard.press('Tab');
      const activeLabel = await harness.page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) {
          return '';
        }

        return (
          element.getAttribute('aria-label') ??
          element.getAttribute('title') ??
          element.textContent?.replace(/\s+/g, ' ').trim() ??
          ''
        );
      });
      focusOrder.push(activeLabel);
    }

    expect(focusOrder[0]).toBe('Library');
    expect(focusOrder[1]).toBe('Agenda');

    const commandButtons = ['Back', 'Search', 'Refresh', 'Export notes'];
    const commandIndexes = commandButtons.map((label) =>
      focusOrder.indexOf(label),
    );
    expect(commandIndexes.every((index) => index >= 0)).toBe(true);
    expect(Math.max(...commandIndexes)).toBeLessThan(14);
    expect(focusOrder.some((label) => label.includes('2026'))).toBe(true);

    const firstTalkCard = harness.page.locator('.agenda-talk-card').first();
    await expect(firstTalkCard.getByText('PDF')).toBeVisible();
    await expect(firstTalkCard.getByText('3 annotated slides')).toBeVisible();
  } finally {
    await harness.close();
  }
});

test('keeps large agenda and long deck navigation responsive enough', async () => {
  const harness = await openLargeAgendaWithCachedDeck();

  try {
    await harness.page.setViewportSize({ width: 1220, height: 900 });

    const openTalkStart = performance.now();
    await harness.page
      .getByRole('button', {
        name: 'Open talk for Conference notes in the flow of the talk',
      })
      .click();

    await expect(
      harness.page.getByRole('heading', {
        name: 'Conference notes in the flow of the talk',
      }),
    ).toBeVisible();
    await expect(harness.page.getByText('Slides ready.')).toBeVisible({
      timeout: 30_000,
    });

    const openTalkElapsed = performance.now() - openTalkStart;
    expect(
      openTalkElapsed,
      `opening the long deck took ${openTalkElapsed.toFixed(0)}ms`,
    ).toBeLessThan(20_000);

    const jumpStart = performance.now();
    await harness.page.getByLabel('Jump to slide').fill('3');
    await harness.page.getByRole('button', { name: 'Go' }).click();

    await expect(harness.page.getByText('3 / 3 slides')).toBeVisible();

    const jumpElapsed = performance.now() - jumpStart;
    expect(
      jumpElapsed,
      `jumping within the long deck took ${jumpElapsed.toFixed(0)}ms`,
    ).toBeLessThan(5_000);
  } finally {
    await harness.close();
  }
});
