import type { InkStroke } from './strokeTools';
import type { WorkspacePages } from './workspaceHistory';

export const INK_PERFORMANCE_PAGE_COUNT = 50;
export const INK_PERFORMANCE_STROKE_COUNT = 1_000;
export const INK_PERFORMANCE_DENSE_PAGE_STROKE_COUNT = 500;
export const INK_PERFORMANCE_POINTS_PER_STROKE = 100;

const createFixtureStroke = (
  strokeIndex: number,
  pageIndex: number,
): InkStroke => ({
  id: `performance-stroke-${strokeIndex}`,
  pageNumber: pageIndex + 1,
  baseWidth: 2,
  points: Array.from(
    { length: INK_PERFORMANCE_POINTS_PER_STROKE },
    (_, pointIndex) => {
      const progress = pointIndex / (INK_PERFORMANCE_POINTS_PER_STROKE - 1);
      const row = strokeIndex % 40;
      return {
        x: 0.05 + progress * 0.9,
        y:
          0.05 +
          (row / 40) * 0.9 +
          Math.sin((progress + strokeIndex) * Math.PI * 2) * 0.002,
        pressure: 0.25 + ((pointIndex + strokeIndex) % 50) / 100,
        time: strokeIndex * 1_000 + pointIndex,
      };
    },
  ),
});

export const createInkPerformanceFixture = (): WorkspacePages => {
  const strokesByPage = Array.from(
    { length: INK_PERFORMANCE_PAGE_COUNT },
    () => [] as InkStroke[],
  );

  for (
    let strokeIndex = 0;
    strokeIndex < INK_PERFORMANCE_STROKE_COUNT;
    strokeIndex += 1
  ) {
    const pageIndex =
      strokeIndex < INK_PERFORMANCE_DENSE_PAGE_STROKE_COUNT
        ? 0
        : 1 +
          ((strokeIndex - INK_PERFORMANCE_DENSE_PAGE_STROKE_COUNT) %
            (INK_PERFORMANCE_PAGE_COUNT - 2));
    strokesByPage[pageIndex]!.push(createFixtureStroke(strokeIndex, pageIndex));
  }

  return {
    strokesByPage,
    textNotesByPage: Array.from(
      { length: INK_PERFORMANCE_PAGE_COUNT },
      () => [],
    ),
  };
};
