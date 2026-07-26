import { describe, expect, it } from 'vitest';

import {
  strokeHitsPoint,
  createStrokeSegmentCache,
  createStrokeSegmentList,
  getStrokeWidth,
} from './strokeTools';

describe('strokeTools', () => {
  const pageSize = {
    width: 100,
    height: 100,
  };

  it('reuses rendered segments and only calculates newly appended points', () => {
    const firstPoint = { x: 0.1, y: 0.1, pressure: 0.5, time: 1 };
    const secondPoint = { x: 0.2, y: 0.2, pressure: 0.5, time: 2 };
    const thirdPoint = { x: 0.3, y: 0.3, pressure: 0.5, time: 3 };
    const cache = createStrokeSegmentCache();
    const firstSegments = cache.get(
      {
        id: 'stroke-1',
        pageNumber: 1,
        points: [firstPoint, secondPoint],
      },
      pageSize,
    );
    const unchangedSegments = cache.get(
      {
        id: 'stroke-1',
        pageNumber: 1,
        points: [firstPoint, secondPoint],
      },
      pageSize,
    );
    const appendedSegments = cache.get(
      {
        id: 'stroke-1',
        pageNumber: 1,
        points: [firstPoint, secondPoint, thirdPoint],
      },
      pageSize,
    );

    expect(unchangedSegments).toBe(firstSegments);
    expect(appendedSegments).toBe(firstSegments);
    expect(appendedSegments).toHaveLength(2);
    expect(appendedSegments[0]).toBe(firstSegments[0]);
  });

  it('scales stroke width with pressure up to 50 percent', () => {
    expect(getStrokeWidth(0)).toBeCloseTo(2, 5);
    expect(getStrokeWidth(1)).toBeCloseTo(3, 5);
    expect(getStrokeWidth(1, 6)).toBeCloseTo(9, 5);
  });

  it('builds screen-space segments for rendered strokes', () => {
    const segments = createStrokeSegmentList(
      [
        { x: 0.1, y: 0.2, pressure: 0.2, time: 1 },
        { x: 0.5, y: 0.6, pressure: 0.8, time: 2 },
      ],
      pageSize,
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      x1: 10,
      y1: 20,
      x2: 50,
      y2: 60,
    });

    expect(
      createStrokeSegmentList(
        [
          { x: 0.1, y: 0.2, pressure: 0.2, time: 1 },
          { x: 0.5, y: 0.6, pressure: 0.8, time: 2 },
        ],
        pageSize,
        6,
      )[0]?.width,
    ).toBeCloseTo(7.5, 5);
  });

  it('skips zero-sized pages when rendering or hit-testing strokes', () => {
    const stroke = {
      id: 'stroke-1',
      pageNumber: 1,
      points: [
        { x: 0.1, y: 0.1, pressure: 0.5, time: 1 },
        { x: 0.9, y: 0.9, pressure: 0.5, time: 2 },
      ],
    };

    expect(
      createStrokeSegmentList(stroke.points, { width: 0, height: 100 }),
    ).toEqual([]);
    expect(
      strokeHitsPoint(stroke, stroke.points[0]!, { width: 0, height: 100 }),
    ).toBe(false);
  });

  it('hits strokes that intersect the eraser radius', () => {
    expect(
      strokeHitsPoint(
        {
          id: 'stroke-1',
          pageNumber: 1,
          points: [
            { x: 0.1, y: 0.1, pressure: 0.5, time: 1 },
            { x: 0.9, y: 0.9, pressure: 0.5, time: 2 },
          ],
        },
        { x: 0.5, y: 0.5, pressure: 0.5, time: 3 },
        pageSize,
      ),
    ).toBe(true);
  });
});
