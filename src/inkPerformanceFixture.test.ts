import { describe, expect, it } from 'vitest';

import {
  createInkPerformanceFixture,
  INK_PERFORMANCE_DENSE_PAGE_STROKE_COUNT,
  INK_PERFORMANCE_PAGE_COUNT,
  INK_PERFORMANCE_POINTS_PER_STROKE,
  INK_PERFORMANCE_STROKE_COUNT,
} from './inkPerformanceFixture';

describe('deterministic ink performance fixture', () => {
  it('contains the acceptance-size page and stroke distribution', () => {
    const fixture = createInkPerformanceFixture();
    expect(fixture.strokesByPage).toHaveLength(INK_PERFORMANCE_PAGE_COUNT);
    expect(fixture.strokesByPage.flat()).toHaveLength(
      INK_PERFORMANCE_STROKE_COUNT,
    );
    expect(fixture.strokesByPage[0]).toHaveLength(
      INK_PERFORMANCE_DENSE_PAGE_STROKE_COUNT,
    );
    expect(fixture.strokesByPage[0]?.[0]?.points).toHaveLength(
      INK_PERFORMANCE_POINTS_PER_STROKE,
    );
  });
});
