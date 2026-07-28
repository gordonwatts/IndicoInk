import { describe, expect, it } from 'vitest';

import { dropExactDuplicatePoints } from './inkCanvas';
import { createStrokeSpatialIndex } from './strokeSpatialIndex';

describe('low-latency ink helpers', () => {
  it('drops only exact duplicate samples', () => {
    const first = { x: 0.1, y: 0.2, pressure: 0.5, time: 1 };
    const samePositionLater = { ...first, time: 2 };
    expect(
      dropExactDuplicatePoints(first, [
        { ...first },
        samePositionLater,
        { x: 0.2, y: 0.3, pressure: 0.6, time: 3 },
      ]),
    ).toEqual([samePositionLater, { x: 0.2, y: 0.3, pressure: 0.6, time: 3 }]);
  });

  it('queries nearby stroke bounds without returning distant strokes', () => {
    const index = createStrokeSpatialIndex(
      [
        {
          id: 'near',
          pageNumber: 1,
          points: [
            { x: 0.1, y: 0.1, pressure: 0.5, time: 1 },
            { x: 0.2, y: 0.2, pressure: 0.5, time: 2 },
          ],
        },
        {
          id: 'far',
          pageNumber: 1,
          points: [
            { x: 0.8, y: 0.8, pressure: 0.5, time: 1 },
            { x: 0.9, y: 0.9, pressure: 0.5, time: 2 },
          ],
        },
      ],
      { width: 1000, height: 1000 },
    );
    expect(
      Array.from(index.query({ x: 0.15, y: 0.15, pressure: 0.5, time: 3 })),
    ).toContain('near');
    expect(
      Array.from(index.query({ x: 0.15, y: 0.15, pressure: 0.5, time: 3 })),
    ).not.toContain('far');
  });
});
