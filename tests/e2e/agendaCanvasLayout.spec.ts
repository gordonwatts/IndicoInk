import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  launchElectronHarness,
  runElectronImportFixtureCommand,
} from './electronHarness';

test('renders agenda canvas cards without same-column overlap', async () => {
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-agenda-'));

  await runElectronImportFixtureCommand({
    userDataDir,
    fixtureName: 'large',
  });

  const harness = await launchElectronHarness({ userDataDir });

  try {
    await harness.page.setViewportSize({ width: 1220, height: 900 });

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

    await harness.page
      .getByLabel('Agenda day canvas')
      .screenshot({ path: 'test-results/agenda-canvas-layout.png' });
    await harness.page.getByLabel('Agenda day canvas').evaluate((element) => {
      element.scrollTop = 920;
    });
    await harness.page
      .getByLabel('Agenda day canvas')
      .screenshot({ path: 'test-results/agenda-canvas-layout-scrolled.png' });

    const layoutReport = await harness.page.evaluate(() => {
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
      };
    });

    expect(layoutReport.overlaps).toEqual([]);
    expect(layoutReport.cardOverflows).toEqual([]);
    expect(layoutReport.markerRegressions).toEqual([]);
  } finally {
    await harness.close();
  }
});
