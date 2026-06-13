import { test, expect } from '@playwright/test';

import { launchElectronHarness } from './electronHarness';

test('persists a workspace across restart', async () => {
  const sourceUrl = 'C:\\slides\\persisted-workspace.pdf';

  const firstApp = await launchElectronHarness();

  const savedWorkspace = await firstApp.page.evaluate(
    async (workspaceSourceUrl) =>
      window.indicoInk.savePdfWorkspaceState({
        sourceUrl: workspaceSourceUrl,
        pageCount: 2,
        strokesByPage: [
          [
            {
              id: 'stroke-1',
              pageNumber: 1,
              points: [
                { x: 0.1, y: 0.2, pressure: 0.4, time: 1 },
                { x: 0.3, y: 0.4, pressure: 0.8, time: 2 },
              ],
            },
          ],
          [],
        ],
        textNotesByPage: [[], []],
        undoStack: [
          [
            {
              strokes: [
                {
                  id: 'stroke-undo',
                  pageNumber: 1,
                  points: [
                    { x: 0.15, y: 0.25, pressure: 0.5, time: 3 },
                    { x: 0.25, y: 0.35, pressure: 0.7, time: 4 },
                  ],
                },
              ],
              textNotes: [],
            },
            {
              strokes: [],
              textNotes: [],
            },
          ],
        ],
        redoStack: [
          [
            {
              strokes: [],
              textNotes: [],
            },
            {
              strokes: [
                {
                  id: 'stroke-redo',
                  pageNumber: 2,
                  points: [
                    { x: 0.45, y: 0.55, pressure: 0.3, time: 5 },
                    { x: 0.65, y: 0.75, pressure: 0.6, time: 6 },
                  ],
                },
              ],
              textNotes: [],
            },
          ],
        ],
        currentSlideNumber: 2,
        scrollLeft: 17,
        scrollTop: 42,
        zoom: 1.25,
      }),
    sourceUrl,
  );

  expect(savedWorkspace.sourceUrl).toBe(sourceUrl);
  expect(savedWorkspace.pageCount).toBe(2);
  await firstApp.close();

  const secondApp = await launchElectronHarness({
    userDataDir: firstApp.userDataDir,
  });

  const restoredWorkspace = await secondApp.page.evaluate(
    async (workspaceSourceUrl) =>
      window.indicoInk.loadPdfWorkspaceState(workspaceSourceUrl),
    sourceUrl,
  );

  expect(restoredWorkspace).not.toBeNull();
  expect(restoredWorkspace?.strokesByPage[0]).toHaveLength(1);
  expect(restoredWorkspace?.strokesByPage[1]).toHaveLength(0);
  expect(restoredWorkspace?.textNotesByPage?.[0]).toHaveLength(0);
  expect(restoredWorkspace?.undoStack).toHaveLength(1);
  expect(restoredWorkspace?.undoStack?.[0]?.[0]?.strokes).toHaveLength(1);
  expect(restoredWorkspace?.undoStack?.[0]?.[0]?.strokes[0]?.pageNumber).toBe(
    1,
  );
  expect(restoredWorkspace?.redoStack).toHaveLength(1);
  expect(restoredWorkspace?.redoStack?.[0]?.[1]?.strokes).toHaveLength(1);
  expect(restoredWorkspace?.redoStack?.[0]?.[1]?.strokes[0]?.pageNumber).toBe(
    2,
  );
  expect(restoredWorkspace?.currentSlideNumber).toBe(2);
  expect(restoredWorkspace?.scrollLeft).toBe(17);
  expect(restoredWorkspace?.scrollTop).toBe(42);
  expect(restoredWorkspace?.zoom).toBe(1.25);

  await secondApp.close();
});
