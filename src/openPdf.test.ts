import { describe, expect, it, vi } from 'vitest';

import { openPdfSelection, resolvePdfSelection } from './openPdf';

describe('resolvePdfSelection', () => {
  it('returns canceled when the dialog is dismissed', () => {
    expect(resolvePdfSelection([])).toEqual({
      canceled: true,
      filePath: null,
    });
    expect(resolvePdfSelection(undefined)).toEqual({
      canceled: true,
      filePath: null,
    });
  });

  it('returns the first selected PDF path', () => {
    expect(resolvePdfSelection(['C:/fixtures/sample.pdf'])).toEqual({
      canceled: false,
      filePath: 'C:/fixtures/sample.pdf',
    });
  });

  it('passes the expected open-file options to the dialog helper', async () => {
    const showOpenPdfDialog = vi.fn().mockResolvedValue({
      filePaths: ['C:/fixtures/sample.pdf'],
    });

    await expect(openPdfSelection(showOpenPdfDialog)).resolves.toEqual({
      canceled: false,
      filePath: 'C:/fixtures/sample.pdf',
    });
    expect(showOpenPdfDialog).toHaveBeenCalledWith({
      title: 'Open PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
  });
});
