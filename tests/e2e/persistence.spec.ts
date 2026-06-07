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
  expect(restoredWorkspace?.currentSlideNumber).toBe(2);
  expect(restoredWorkspace?.scrollLeft).toBe(17);
  expect(restoredWorkspace?.scrollTop).toBe(42);
  expect(restoredWorkspace?.zoom).toBe(1.25);

  await secondApp.close();
});
