import { describe, expect, it } from 'vitest';
import { advanceTouchMomentum, getTouchPanVelocity } from './touchMomentum';

describe('touch momentum', () => {
  it('converts recent finger movement into scroll velocity', () => {
    expect(
      getTouchPanVelocity([
        { x: 200, y: 300, time: 0 },
        { x: 140, y: 240, time: 60 },
      ]),
    ).toEqual({ x: 1, y: 1 });
  });

  it('decelerates and advances both scroll axes', () => {
    const next = advanceTouchMomentum(
      { x: 100, y: 200 },
      { x: 1, y: -0.5 },
      100,
      { maxX: 1000, maxY: 1000 },
    );

    expect(next.position).toEqual({ x: 176, y: 174 });
    expect(next.velocity.x).toBeCloseTo(0.76);
    expect(next.velocity.y).toBeCloseTo(-0.26);
    expect(next.isActive).toBe(true);
  });

  it('stops the axis that reaches a scroll boundary', () => {
    const next = advanceTouchMomentum({ x: 5, y: 400 }, { x: -1, y: 0 }, 100, {
      maxX: 500,
      maxY: 800,
    });

    expect(next.position.x).toBe(0);
    expect(next.velocity.x).toBe(0);
    expect(next.isActive).toBe(false);
  });
});
