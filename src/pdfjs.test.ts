import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

import { configurePdfJsCompatibility, getPdfWorkerSrc } from './pdfjs';

describe('pdfjs compatibility', () => {
  it('exposes a packaged-friendly worker url', () => {
    expect(getPdfWorkerSrc()).toContain('pdf.worker.min.mjs');
  });

  it('configures the global worker src before pdf.js loads', () => {
    const originalWorkerSrc = GlobalWorkerOptions.workerSrc;

    try {
      const configured = configurePdfJsCompatibility();

      expect(configured.workerSrc).toBe(getPdfWorkerSrc());
      expect(GlobalWorkerOptions.workerSrc).toBe(getPdfWorkerSrc());
    } finally {
      GlobalWorkerOptions.workerSrc = originalWorkerSrc;
    }
  });
});
