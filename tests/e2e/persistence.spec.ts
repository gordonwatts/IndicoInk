import { test, expect } from '@playwright/test';

import { launchElectronHarness } from './electronHarness';

test('persists a workspace across restart', async () => {
  const sourceUrl = 'C:\\slides\\persisted-workspace.pdf';

  const firstApp = await launchElectronHarness();

  const savedWorkspace = await firstApp.page.evaluate(
    async (workspaceSourceUrl) =>
      window.indicoInk.savePdfWorkspaceChanges({
        sourceUrl: workspaceSourceUrl,
        pageCount: 2,
        revision: 1,
        changes: [
          {
            kind: 'upsert-stroke',
            pageIndex: 0,
            stroke: {
              id: 'stroke-1',
              pageNumber: 1,
              points: [
                { x: 0.1, y: 0.2, pressure: 0.4, time: 1 },
                { x: 0.3, y: 0.4, pressure: 0.8, time: 2 },
              ],
            },
          },
        ],
        history: {
          version: 2,
          undo: [
            {
              id: 'history-undo',
              changes: [
                {
                  kind: 'stroke',
                  pageIndex: 0,
                  annotationId: 'stroke-1',
                  before: null,
                  after: {
                    index: 0,
                    value: {
                      id: 'stroke-1',
                      pageNumber: 1,
                      points: [
                        { x: 0.1, y: 0.2, pressure: 0.4, time: 1 },
                        { x: 0.3, y: 0.4, pressure: 0.8, time: 2 },
                      ],
                    },
                  },
                },
              ],
            },
          ],
          redo: [
            {
              id: 'history-redo',
              changes: [
                {
                  kind: 'stroke',
                  pageIndex: 1,
                  annotationId: 'stroke-redo',
                  before: null,
                  after: {
                    index: 0,
                    value: {
                      id: 'stroke-redo',
                      pageNumber: 2,
                      points: [
                        { x: 0.45, y: 0.55, pressure: 0.3, time: 5 },
                        { x: 0.65, y: 0.75, pressure: 0.6, time: 6 },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
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
  expect(restoredWorkspace?.history?.undo).toHaveLength(1);
  expect(restoredWorkspace?.history?.undo[0]?.changes[0]).toMatchObject({
    kind: 'stroke',
    pageIndex: 0,
    annotationId: 'stroke-1',
  });
  expect(restoredWorkspace?.history?.redo).toHaveLength(1);
  expect(restoredWorkspace?.history?.redo[0]?.changes[0]).toMatchObject({
    kind: 'stroke',
    pageIndex: 1,
    annotationId: 'stroke-redo',
  });
  expect(restoredWorkspace?.currentSlideNumber).toBe(2);
  expect(restoredWorkspace?.scrollLeft).toBe(17);
  expect(restoredWorkspace?.scrollTop).toBe(42);
  expect(restoredWorkspace?.zoom).toBe(1.25);

  await secondApp.close();
});
