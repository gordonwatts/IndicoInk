import { describe, expect, it } from 'vitest';

import {
  findIncrementalBuildPageNumbers,
  isIncrementalSlideBuild,
  type PixelPage,
} from './incrementalSlides';

const createPage = (
  width: number,
  height: number,
  pixels: Array<{
    x: number;
    y: number;
    color?: readonly [number, number, number];
  }> = [],
): PixelPage => {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  pixels.forEach(({ x, y, color = [0, 0, 0] }) => {
    const offset = (y * width + x) * 4;
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
  });
  return { width, height, data };
};

describe('incremental slide detection', () => {
  const firstLine = [
    { x: 2, y: 2 },
    { x: 3, y: 2 },
    { x: 4, y: 2 },
    { x: 5, y: 2 },
  ];
  const secondLine = [
    { x: 2, y: 4 },
    { x: 3, y: 4 },
    { x: 4, y: 4 },
    { x: 5, y: 4 },
  ];

  it('recognizes a page that only adds content', () => {
    expect(
      isIncrementalSlideBuild(
        createPage(10, 10, firstLine),
        createPage(10, 10, [...firstLine, ...secondLine]),
      ),
    ).toBe(true);
  });

  it('recognizes additions on a transparent PDF canvas', () => {
    const createTransparentPage = (pixels: Array<{ x: number; y: number }>) => {
      const data = new Uint8ClampedArray(10 * 10 * 4);
      pixels.forEach(({ x, y }) => {
        const offset = (y * 10 + x) * 4;
        data[offset + 3] = 255;
      });
      return { width: 10, height: 10, data };
    };

    expect(
      isIncrementalSlideBuild(
        createTransparentPage(firstLine),
        createTransparentPage([...firstLine, ...secondLine]),
      ),
    ).toBe(true);
  });

  it('keeps pages that remove or replace content', () => {
    expect(
      isIncrementalSlideBuild(
        createPage(10, 10, [...firstLine, ...secondLine]),
        createPage(10, 10, firstLine),
      ),
    ).toBe(false);
    expect(
      isIncrementalSlideBuild(
        createPage(10, 10, firstLine),
        createPage(
          10,
          10,
          firstLine.map((pixel) => ({ ...pixel, color: [220, 0, 0] as const })),
        ),
      ),
    ).toBe(false);
  });

  it('keeps pages with different dimensions or no meaningful change', () => {
    expect(
      isIncrementalSlideBuild(
        createPage(10, 10, firstLine),
        createPage(12, 10, [...firstLine, ...secondLine]),
      ),
    ).toBe(false);
    expect(
      isIncrementalSlideBuild(
        createPage(10, 10, firstLine),
        createPage(10, 10, firstLine),
      ),
    ).toBe(false);
  });

  it('keeps pages when a broad background transition changes most pixels', () => {
    const width = 100;
    const height = 100;
    const createGradientPage = (strength: number): PixelPage => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const interior =
            x > 2 && x < width - 3 && y > 2 && y < height - 3 ? 1 : 0;
          const pixelOffset = (y * width + x) * 4;
          data[pixelOffset] = 40 + Math.round(strength * interior);
          data[pixelOffset + 1] = 80 + Math.round(strength * interior);
          data[pixelOffset + 2] = 120 + Math.round(strength * interior);
          data[pixelOffset + 3] = 255;
        }
      }
      return { width, height, data };
    };

    expect(
      isIncrementalSlideBuild(createGradientPage(0), createGradientPage(160)),
    ).toBe(false);
  });
  it('collapses every intermediate page in a multi-step build', () => {
    const thirdLine = [
      { x: 2, y: 6 },
      { x: 3, y: 6 },
      { x: 4, y: 6 },
      { x: 5, y: 6 },
    ];
    expect(
      findIncrementalBuildPageNumbers([
        createPage(10, 10, firstLine),
        createPage(10, 10, [...firstLine, ...secondLine]),
        createPage(10, 10, [...firstLine, ...secondLine, ...thirdLine]),
      ]),
    ).toEqual([1, 2]);
  });
});
