import { describe, expect, it } from 'vitest';

import {
  clampPdfZoom,
  getFocalScrollPosition,
  getPinchDistance,
  getPinchMidpoint,
  getPinchZoom,
  MAX_PDF_ZOOM,
  MIN_PDF_ZOOM,
} from './pdfZoom';

describe('pdf zoom helpers', () => {
  it('keeps zoom at or above the fit-to-width baseline', () => {
    expect(MIN_PDF_ZOOM).toBe(1);
    expect(clampPdfZoom(0.4)).toBe(MIN_PDF_ZOOM);
    expect(clampPdfZoom(1.6)).toBe(1.6);
    expect(clampPdfZoom(9)).toBe(MAX_PDF_ZOOM);
  });

  it('derives pinch distance, midpoint, and clamped scale', () => {
    const first = { x: 10, y: 20 };
    const second = { x: 40, y: 60 };

    expect(getPinchDistance(first, second)).toBe(50);
    expect(getPinchMidpoint(first, second)).toEqual({ x: 25, y: 40 });
    expect(getPinchZoom(1.2, 100, 50)).toBe(MIN_PDF_ZOOM);
    expect(getPinchZoom(1.2, 100, 200)).toBe(2.4);
    expect(getPinchZoom(2, 100, 200)).toBe(MAX_PDF_ZOOM);
  });

  it('calculates scroll needed to keep the focal page point under the midpoint', () => {
    expect(
      getFocalScrollPosition({
        pageLeft: 100,
        pageTop: 200,
        pageWidth: 400,
        pageHeight: 800,
        pageOffsetXRatio: 0.5,
        pageOffsetYRatio: 0.25,
        midpoint: { x: 220, y: 240 },
        viewportLeft: 20,
        viewportTop: 40,
        scrollLeft: 50,
        scrollTop: 60,
      }),
    ).toEqual({ left: 130, top: 220 });
  });
});
