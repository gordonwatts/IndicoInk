import { describe, expect, it } from 'vitest';

import { toNormalizedPagePoint, toScreenPoint } from './inkGeometry';

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
});
