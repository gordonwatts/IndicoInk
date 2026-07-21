import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  launchElectronHarness,
  runElectronImportFixtureCommand,
} from './electronHarness';
import {
  createConferenceId,
  createDeckId,
  createTalkId,
} from '../../src/persistenceModels';

const packagedExportPath = resolve(
  tmpdir(),
  `indicoink-packaged-export-${Date.now()}.md`,
);

async function openAcceptanceTalk(page: import('@playwright/test').Page) {
  await page
    .getByRole('button', {
      name: 'Open IndicoInk Packaged Acceptance 2026',
    })
    .click();

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    page.getByText('Cached for offline use', {
      exact: false,
    }),
  ).toBeVisible();

  await page
    .getByRole('button', {
      name: 'Open talk for Packaging acceptance flow',
    })
    .click();

  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
}

async function drawAcceptanceStroke(page: import('@playwright/test').Page) {
  const sheet = page.locator('.pdf-preview-sheet').first();
  const box = await sheet.boundingBox();
  if (!box) {
    throw new Error('Acceptance PDF sheet was not visible.');
  }

  const startX = Math.round(box.x + box.width * 0.2);
  const startY = Math.round(box.y + box.height * 0.32);
  const midX = Math.round(box.x + box.width * 0.45);
  const midY = Math.round(box.y + box.height * 0.5);
  const endX = Math.round(box.x + box.width * 0.68);
  const endY = Math.round(box.y + box.height * 0.42);

  await page.getByRole('button', { name: 'Pen' }).click();
  await page.getByRole('button', { name: 'Draw' }).click();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(midX, midY, { steps: 12 });
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('.pdf-preview-overlay line').first()).toBeVisible();
}

async function addAcceptanceTextNote(page: import('@playwright/test').Page) {
  const sheet = page.locator('.pdf-preview-sheet').first();
  const box = await sheet.boundingBox();
  if (!box) {
    throw new Error('Acceptance PDF sheet was not visible.');
  }

  // Leave enough room on the right for the resize and drag acceptance steps
  // when the PDF fills the viewport at its real zoom level.
  const noteX = Math.round(box.width * 0.2);
  const noteY = Math.round(box.height * 0.26);
  const resizeDelta = Math.max(48, Math.round(box.width * 0.25));

  await page.getByRole('button', { name: 'Text' }).click();
  await sheet.click({ position: { x: noteX, y: noteY } });

  const editor = page.getByRole('textbox', { name: 'Note text on page 1' });
  await expect(editor).toBeVisible();
  await editor.fill('Acceptance note');
  await sheet.click({ position: { x: 16, y: 16 } });

  await expect(page.getByText('Acceptance note')).toBeVisible();
  const dragHandle = page.getByRole('button', {
    name: 'Drag note on page 1',
  });
  await dragHandle.hover();
  await expect
    .poll(() => dragHandle.evaluate((element) => getComputedStyle(element).opacity))
    .toBe('1');

  await page.getByRole('button', { name: 'Acceptance note' }).click();
  await expect(editor).toBeVisible();
  await expect
    .poll(() => editor.evaluate((element) => element.selectionStart))
    .toBe('Acceptance note'.length);

  const editorBox = await editor.boundingBox();
  const noteWidthBeforeResize = await editor.evaluate((element) =>
    Number.parseFloat((element.parentElement as HTMLElement).style.width),
  );
  const resizeHandle = page.getByRole('button', {
    name: 'Resize note on page 1',
  });
  const resizeHandleBox = await resizeHandle.boundingBox();
  if (!editorBox || !resizeHandleBox) {
    throw new Error('Acceptance text-note resize handle was not visible.');
  }
  await page.mouse.move(
    resizeHandleBox.x + resizeHandleBox.width / 2,
    resizeHandleBox.y + resizeHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await page.mouse.move(
    resizeHandleBox.x + resizeHandleBox.width / 2 + resizeDelta,
    resizeHandleBox.y + resizeHandleBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      editor.evaluate((element) =>
        Number.parseFloat((element.parentElement as HTMLElement).style.width),
      ),
    )
    .toBeGreaterThan(noteWidthBeforeResize + 20);

  const editorPositionBeforeDrag = await editor.boundingBox();
  const dragHandleBox = await dragHandle.boundingBox();
  if (!editorPositionBeforeDrag || !dragHandleBox) {
    throw new Error('Acceptance text-note drag handle was not visible.');
  }
  await page.mouse.move(
    dragHandleBox.x + dragHandleBox.width / 2,
    dragHandleBox.y + dragHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await page.mouse.move(
    dragHandleBox.x + dragHandleBox.width / 2 + 36,
    dragHandleBox.y + dragHandleBox.height / 2 + 24,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await editor.boundingBox())?.x ?? 0)
    .toBeGreaterThan(editorPositionBeforeDrag.x + 20);

  await editor.fill('Edited acceptance note');
  await editor.press('Enter');

  await expect(page.getByText('Edited acceptance note')).toBeVisible();

  await page.getByRole('button', { name: 'Pen' }).click();
  const strokeCount = await page.locator('.pdf-preview-overlay line').count();
  await page.getByRole('button', { name: 'Edited acceptance note' }).click();
  await expect(editor).toBeVisible();
  await expect(page.locator('.pdf-preview-overlay line')).toHaveCount(strokeCount);
  await editor.press('Escape');
}

test.describe.serial('packaged app', () => {
  test.beforeAll(async () => {
    execSync('npm run package', {
      stdio: 'inherit',
      env: process.env,
    });
  });

  test.afterAll(() => {
    if (existsSync(packagedExportPath)) {
      rmSync(packagedExportPath, { force: true });
    }
  });

  test('opens a cached event, restores annotations, and exports notes', async () => {
    const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-packaged-'));
    const conferenceSourceUrl =
      'https://packaged.indico.example.org/event/indicoink-packaged-2026';
    const conferenceId = createConferenceId(conferenceSourceUrl);
    const talkContributionId = 'packaged-1001';
    const deckSourceUrl =
      'https://packaged.indico.example.org/event/indicoink-packaged-2026/materials/packaged-1001-slides.pdf';
    const talkId = createTalkId(conferenceId, talkContributionId);
    const deckId = createDeckId(talkId, deckSourceUrl);
    const cacheFilePath = resolve(
      userDataDir,
      'deck-cache',
      conferenceId,
      `${deckId}.pdf`,
    );

    await runElectronImportFixtureCommand({
      userDataDir,
      fixtureName: 'packaged',
    });

    mkdirSync(resolve(cacheFilePath, '..'), { recursive: true });
    copyFileSync(resolve('tests/fixtures/pdfs/one-page.pdf'), cacheFilePath);

    const harness = await launchElectronHarness({
      userDataDir,
      extraEnv: {
        INDICOINK_EXPORT_TEST_PATH: packagedExportPath,
      },
    });

    try {
      await expect(
        harness.page.getByRole('button', {
          name: 'Open IndicoInk Packaged Acceptance 2026',
        }),
      ).toBeVisible({ timeout: 60_000 });

      await openAcceptanceTalk(harness.page);
      await drawAcceptanceStroke(harness.page);
      await addAcceptanceTextNote(harness.page);

      await expect
        .poll(
          async () => {
            const storedWorkspace = await harness.page.evaluate(
              async ({ deckId: storedDeckId }) =>
                window.indicoInk.loadDeckWorkspaceState(storedDeckId),
              { deckId },
            );
            return storedWorkspace?.textNotesByPage?.[0]?.length ?? 0;
          },
          { timeout: 15_000 },
        )
        .toBe(1);

      await harness.page
        .getByRole('button', { name: 'Back', exact: true })
        .click();

      await harness.close();

      const reloadedHarness = await launchElectronHarness({
        userDataDir,
        extraEnv: {
          INDICOINK_EXPORT_TEST_PATH: packagedExportPath,
        },
      });

      try {
        await expect(
          reloadedHarness.page.getByRole('button', {
            name: 'Open IndicoInk Packaged Acceptance 2026',
          }),
        ).toBeVisible({ timeout: 60_000 });

        await openAcceptanceTalk(reloadedHarness.page);
        await expect(
          reloadedHarness.page.locator('.pdf-preview-overlay line').first(),
        ).toBeVisible();
        await expect
          .poll(
            async () => {
              const restoredWorkspace = await reloadedHarness.page.evaluate(
                async ({ deckId: restoredDeckId }) =>
                  window.indicoInk.loadDeckWorkspaceState(restoredDeckId),
                { deckId },
              );
              return restoredWorkspace?.textNotesByPage?.[0]?.length ?? 0;
            },
            { timeout: 15_000 },
          )
          .toBe(1);

        await reloadedHarness.page
          .getByRole('button', { name: 'Back', exact: true })
          .click();
        await reloadedHarness.page
          .getByRole('button', { name: 'Export notes' })
          .click();

        const exportDialog = reloadedHarness.page.getByRole('dialog', {
          name: 'Export notes',
        });
        await expect(
          exportDialog.getByRole('button', { name: 'Open file location' }),
        ).toBeVisible({ timeout: 60_000 });

        await reloadedHarness.page
          .getByRole('button', { name: 'Open file location' })
          .click();
      } finally {
        await reloadedHarness.close();
      }
    } finally {
      await harness.close().catch(() => {});
    }

    expect(existsSync(packagedExportPath)).toBe(true);
    const exportedMarkdown = readFileSync(packagedExportPath, 'utf8');
    expect(exportedMarkdown).toContain('IndicoInk Packaged Acceptance 2026');
    expect(exportedMarkdown).toContain('Packaging acceptance flow');
    expect(exportedMarkdown).toContain('data:image/png;base64,');
  });
});
