import { describe, expect, it } from 'vitest';

import {
  toNormalizedPagePoint,
  toNormalizedViewportPoint,
  toScreenPoint,
} from './inkGeometry';

describe('inkGeometry', () => {
  it('round-trips screen points through normalized page coordinates', () => {
    const pageSize = {
      width: 800,
      height: 600,
    };
    const point = {
      x: 160,
      y: 270,
      pressure: 0.74,
      time: 1_725_000_123_456,
    };

    const normalizedPoint = toNormalizedPagePoint(point, pageSize);
    const roundTrippedPoint = toScreenPoint(normalizedPoint, pageSize);

    expect(normalizedPoint.x).toBeCloseTo(0.2, 10);
    expect(normalizedPoint.y).toBeCloseTo(0.45, 10);
    expect(roundTrippedPoint.x).toBeCloseTo(point.x, 10);
    expect(roundTrippedPoint.y).toBeCloseTo(point.y, 10);
    expect(roundTrippedPoint.pressure).toBe(point.pressure);
    expect(roundTrippedPoint.time).toBe(point.time);
  });

  it('rejects page sizes that cannot be normalized', () => {
    expect(() =>
      toNormalizedPagePoint(
        {
          x: 1,
          y: 1,
          pressure: 0.5,
          time: 1,
        },
        {
          width: 0,
          height: 600,
        },
      ),
    ).toThrow('Page size must be greater than zero.');
  });

  it.each([
    {
      orientation: 'landscape',
      bounds: { left: 120, top: 80, width: 960, height: 540 },
    },
    {
      orientation: 'portrait',
      bounds: { left: 40, top: 260, width: 480, height: 270 },
    },
  ])(
    'normalizes client coordinates against the displayed page in $orientation',
    ({ bounds }) => {
      const normalizedPoint = toNormalizedViewportPoint(
        {
          x: bounds.left + bounds.width * 0.7,
          y: bounds.top + bounds.height * 0.8,
          pressure: 0.62,
          time: 42,
        },
        bounds,
      );

      expect(normalizedPoint).toEqual({
        x: 0.7,
        y: 0.8,
        pressure: 0.62,
        time: 42,
      });
    },
  );
});
