import type { NormalizedPagePoint, PageSize } from './inkGeometry';
import { ERASER_HIT_RADIUS, type InkStroke } from './strokeTools';

const GRID_SIZE = 32;

const clampCell = (value: number) =>
  Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(value * GRID_SIZE)));

const cellKey = (x: number, y: number) => `${x}:${y}`;

export type StrokeSpatialIndex = {
  query: (point: NormalizedPagePoint) => Set<string>;
};

export const createStrokeSpatialIndex = (
  strokes: InkStroke[],
  pageSize: PageSize,
): StrokeSpatialIndex => {
  const cells = new Map<string, Set<string>>();
  const paddingX = ERASER_HIT_RADIUS / Math.max(1, pageSize.width);
  const paddingY = ERASER_HIT_RADIUS / Math.max(1, pageSize.height);

  for (const stroke of strokes) {
    if (!stroke.points.length) {
      continue;
    }
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const firstX = clampCell(minX - paddingX);
    const lastX = clampCell(maxX + paddingX);
    const firstY = clampCell(minY - paddingY);
    const lastY = clampCell(maxY + paddingY);
    for (let x = firstX; x <= lastX; x += 1) {
      for (let y = firstY; y <= lastY; y += 1) {
        const key = cellKey(x, y);
        const ids = cells.get(key) ?? new Set<string>();
        ids.add(stroke.id);
        cells.set(key, ids);
      }
    }
  }

  return {
    query: (point) =>
      new Set(cells.get(cellKey(clampCell(point.x), clampCell(point.y))) ?? []),
  };
};
