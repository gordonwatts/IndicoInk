import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';

import {
  createInkPerformanceFixture,
  INK_PERFORMANCE_PAGE_COUNT,
} from '../../src/inkPerformanceFixture';
import {
  createConferenceId,
  createDeckId,
  createTalkId,
} from '../../src/persistenceModels';
import {
  launchElectronHarness,
  runElectronImportFixtureCommand,
} from './electronHarness';

test.describe.configure({ timeout: 300_000 });
test.skip(
  process.env.INDICOINK_RUN_INK_PERF !== '1',
  'Target-device ink performance acceptance is opt-in.',
);

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
};

const drawStrokes = async (
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  count: number,
) => {
  for (let strokeIndex = 0; strokeIndex < count; strokeIndex += 1) {
    const y = box.y + box.height * (0.1 + (strokeIndex % 30) * 0.025);
    await page.mouse.move(box.x + box.width * 0.08, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.92, y + 3, { steps: 100 });
    await page.mouse.up();
  }
};

test('meets the issue 87 loaded-workspace acceptance thresholds', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-ink-perf-'));
  await runElectronImportFixtureCommand({ userDataDir, fixtureName: 'small' });

  const conferenceSourceUrl =
    'https://small.indico.example.org/event/indicoink-small-2026';
  const conferenceId = createConferenceId(conferenceSourceUrl);
  const talkId = createTalkId(conferenceId, 'small-1001');
  const deckSourceUrl =
    'https://small.indico.example.org/event/indicoink-small-2026/materials/small-1001-slides.pdf';
  const deckId = createDeckId(talkId, deckSourceUrl);
  const cacheFilePath = resolve(
    userDataDir,
    'deck-cache',
    conferenceId,
    `${deckId}.pdf`,
  );
  mkdirSync(dirname(cacheFilePath), { recursive: true });
  const pdf = await PDFDocument.create();
  for (
    let pageIndex = 0;
    pageIndex < INK_PERFORMANCE_PAGE_COUNT;
    pageIndex += 1
  ) {
    pdf.addPage([612, 792]);
  }
  writeFileSync(cacheFilePath, await pdf.save());

  const fixture = createInkPerformanceFixture();
  const harness = await launchElectronHarness({ userDataDir });
  try {
    await harness.page.evaluate(
      async ({ sourceUrl, conferenceId, talkId, deckId, strokesByPage }) => {
        await window.indicoInk.saveDeckWorkspaceChanges({
          sourceUrl,
          conferenceId,
          talkId,
          deckId,
          pageCount: strokesByPage.length,
          revision: 1,
          changes: strokesByPage.flatMap((strokes, pageIndex) =>
            strokes.map((stroke) => ({
              kind: 'upsert-stroke' as const,
              pageIndex,
              stroke,
            })),
          ),
          history: { version: 2, undo: [], redo: [] },
          currentSlideNumber: 1,
          scrollLeft: 0,
          scrollTop: 0,
          zoom: 1,
        });
      },
      {
        sourceUrl: deckSourceUrl,
        conferenceId,
        talkId,
        deckId,
        strokesByPage: fixture.strokesByPage,
      },
    );

    await harness.page
      .getByRole('button', { name: 'Open IndicoInk Small Event 2026' })
      .click();
    await harness.page
      .getByRole('button', {
        name: 'Open talk for Designing a calm note-taking workflow',
      })
      .click();
    await expect(harness.page.locator('.pdf-preview-page')).toHaveCount(
      INK_PERFORMANCE_PAGE_COUNT,
      { timeout: 120_000 },
    );
    await expect(
      harness.page.locator('.pdf-preview-stage-status--loading'),
    ).toHaveCount(0, { timeout: 120_000 });
    await expect(
      harness.page.locator('.pdf-preview-ink-canvas.dry').first(),
    ).toHaveAttribute('data-stroke-count', '500');
    await expect(
      harness.page.locator('.pdf-preview-ink-canvas.dry').first(),
    ).toHaveAttribute('data-raster-status', 'ready', { timeout: 120_000 });
    await harness.page
      .getByRole('button', { name: 'Pen', exact: true })
      .click();

    await harness.page.evaluate(() => {
      const runtime = window as typeof window & {
        __indicoInkTrackPdfPreviewRenders?: boolean;
        __inkPerformance?: {
          samplingMove: boolean;
          group: 'loaded' | 'empty';
          delays: Record<'loaded' | 'empty', number[]>;
          mutationsWhileDrawing: number;
          reactRendersDuringMoves: number;
          longTasks: number[];
          recordLongTasks: boolean;
          observer: PerformanceObserver;
        };
      };
      runtime.__indicoInkTrackPdfPreviewRenders = true;
      const metrics = {
        samplingMove: false,
        group: 'loaded' as const,
        delays: { loaded: [] as number[], empty: [] as number[] },
        mutationsWhileDrawing: 0,
        reactRendersDuringMoves: 0,
        longTasks: [] as number[],
        recordLongTasks: false,
        observer: new PerformanceObserver((list) => {
          if (metrics.recordLongTasks) {
            metrics.longTasks.push(
              ...list.getEntries().map((entry) => entry.duration),
            );
          }
        }),
      };
      metrics.observer.observe({ entryTypes: ['longtask'] });
      document.addEventListener(
        'pointerup',
        () => {
          metrics.samplingMove = false;
        },
        true,
      );
      document.addEventListener(
        'pointermove',
        (event) => {
          if (event.buttons === 0) {
            return;
          }
          metrics.samplingMove = true;
          const startedAt = performance.now();
          const renderCountAtStart =
            (
              runtime as typeof runtime & {
                __indicoInkPdfPreviewRenderCount?: number;
              }
            ).__indicoInkPdfPreviewRenderCount ?? 0;
          requestAnimationFrame(() => {
            metrics.delays[metrics.group].push(performance.now() - startedAt);
            const renderCountAfterPaint =
              (
                runtime as typeof runtime & {
                  __indicoInkPdfPreviewRenderCount?: number;
                }
              ).__indicoInkPdfPreviewRenderCount ?? 0;
            if (renderCountAfterPaint !== renderCountAtStart) {
              metrics.reactRendersDuringMoves += 1;
            }
            metrics.samplingMove = false;
          });
        },
        true,
      );
      new MutationObserver((records) => {
        if (metrics.samplingMove) {
          metrics.mutationsWhileDrawing += records.length;
        }
      }).observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      runtime.__inkPerformance = metrics;
    });

    const loadedBox = await harness.page
      .locator('.pdf-preview-sheet')
      .first()
      .boundingBox();
    expect(loadedBox).not.toBeNull();
    await harness.page.evaluate(() => {
      const runtime = window as typeof window & {
        __inkPerformance?: { recordLongTasks: boolean };
      };
      if (runtime.__inkPerformance) {
        runtime.__inkPerformance.recordLongTasks = true;
      }
    });
    await drawStrokes(harness.page, loadedBox!, 30);
    await harness.page.waitForTimeout(2_500);
    await harness.page.evaluate(() => {
      const runtime = window as typeof window & {
        __inkPerformance?: { recordLongTasks: boolean };
      };
      if (runtime.__inkPerformance) {
        runtime.__inkPerformance.recordLongTasks = false;
      }
    });

    const lastSheet = harness.page.locator('.pdf-preview-sheet').last();
    await lastSheet.scrollIntoViewIfNeeded();
    await harness.page.evaluate(() => {
      const runtime = window as typeof window & {
        __inkPerformance?: { group: 'loaded' | 'empty' };
      };
      if (runtime.__inkPerformance) {
        runtime.__inkPerformance.group = 'empty';
      }
    });
    const emptyBox = await lastSheet.boundingBox();
    expect(emptyBox).not.toBeNull();
    await drawStrokes(harness.page, emptyBox!, 10);

    const metrics = await harness.page.evaluate(() => {
      const runtime = window as typeof window & {
        __inkPerformance?: {
          delays: Record<'loaded' | 'empty', number[]>;
          mutationsWhileDrawing: number;
          reactRendersDuringMoves: number;
          longTasks: number[];
        };
      };
      return runtime.__inkPerformance;
    });
    expect(metrics).toBeTruthy();
    const loadedP95 = percentile(metrics!.delays.loaded, 0.95);
    const loadedP99 = percentile(metrics!.delays.loaded, 0.99);
    const emptyP95 = percentile(metrics!.delays.empty, 0.95);
    const svgStrokeLineCount = await harness.page
      .locator('.pdf-preview-overlay line')
      .count();

    const transactionDurations = await harness.page.evaluate(
      async ({ sourceUrl, conferenceId, talkId, deckId }) => {
        const loaded = await window.indicoInk.loadDeckWorkspaceState(deckId);
        const durations: number[] = [];
        let revision = loaded?.revision ?? 1;
        for (let index = 0; index < 20; index += 1) {
          revision += 1;
          const result = await window.indicoInk.saveDeckWorkspaceChanges({
            sourceUrl,
            conferenceId,
            talkId,
            deckId,
            pageCount: loaded?.pageCount ?? 50,
            revision,
            changes: [],
            history: loaded?.history ?? { version: 2, undo: [], redo: [] },
            currentSlideNumber: loaded?.currentSlideNumber ?? 1,
            scrollLeft: loaded?.scrollLeft ?? 0,
            scrollTop: loaded?.scrollTop ?? 0,
            zoom: loaded?.zoom ?? 1,
          });
          durations.push(
            result.transactionDurationMs ?? Number.POSITIVE_INFINITY,
          );
        }
        return durations;
      },
      { sourceUrl: deckSourceUrl, conferenceId, talkId, deckId },
    );
    const transactionP95 = percentile(transactionDurations, 0.95);
    await testInfo.attach('ink-performance-metrics.json', {
      body: JSON.stringify(
        {
          loadedP95,
          loadedP99,
          emptyP95,
          loadedToEmptyRatio: loadedP95 / emptyP95,
          mutationsWhileDrawing: metrics!.mutationsWhileDrawing,
          reactRendersDuringMoves: metrics!.reactRendersDuringMoves,
          longTaskCount: metrics!.longTasks.filter((duration) => duration > 50)
            .length,
          longestTask: Math.max(0, ...metrics!.longTasks),
          svgStrokeLineCount,
          transactionP95,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    process.stdout.write(
      `\nINK_PERFORMANCE_METRICS loadedP95=${loadedP95.toFixed(2)} loadedP99=${loadedP99.toFixed(2)} emptyP95=${emptyP95.toFixed(2)} ratio=${(loadedP95 / emptyP95).toFixed(2)} renders=${metrics!.reactRendersDuringMoves} longTasks=${metrics!.longTasks.filter((duration) => duration > 50).length} transactionP95=${transactionP95.toFixed(2)}\n`,
    );
    expect(loadedP95).toBeLessThanOrEqual(25);
    expect(loadedP99).toBeLessThanOrEqual(50);
    expect(loadedP95).toBeLessThanOrEqual(emptyP95 * 1.5);
    expect(metrics!.reactRendersDuringMoves).toBe(0);
    expect(metrics!.longTasks.filter((duration) => duration > 50)).toEqual([]);
    expect(svgStrokeLineCount).toBe(0);
    expect(transactionP95).toBeLessThan(10);
  } finally {
    await harness.close().catch(() => {});
  }
});
