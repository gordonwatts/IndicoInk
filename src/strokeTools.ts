import { toScreenPoint, type NormalizedPagePoint, type PageSize } from './inkGeometry';

export type InkStroke = {
  id: string;
  pageNumber: number;
  points: NormalizedPagePoint[];
};

export type StrokeSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
};

export const BASE_STROKE_WIDTH = 4;
export const STROKE_PRESSURE_SCALE = 0.5;
export const ERASER_HIT_RADIUS = 12;

export const getStrokeWidth = (pressure: number) =>
  BASE_STROKE_WIDTH * (1 + Math.max(0, Math.min(pressure, 1)) * STROKE_PRESSURE_SCALE);

export const createStrokeSegmentList = (
  points: NormalizedPagePoint[],
  pageSize: PageSize,
): StrokeSegment[] => {
  if (points.length < 2) {
    return [];
  }

  return points.slice(1).map((point, index) => {
    const previousPoint = points[index]!;
    const previousScreenPoint = toScreenPoint(previousPoint, pageSize);
    const screenPoint = toScreenPoint(point, pageSize);

    return {
      x1: previousScreenPoint.x,
      y1: previousScreenPoint.y,
      x2: screenPoint.x,
      y2: screenPoint.y,
      width: (getStrokeWidth(previousPoint.pressure) + getStrokeWidth(point.pressure)) / 2,
    };
  });
};

const distanceToSegment = (
  point: { x: number; y: number },
  segment: StrokeSegment,
) => {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - segment.x1, point.y - segment.y1);
  }

  const t =
    ((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) /
    (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const nearestX = segment.x1 + clampedT * dx;
  const nearestY = segment.y1 + clampedT * dy;

  return Math.hypot(point.x - nearestX, point.y - nearestY);
};

export const strokeHitsPoint = (
  stroke: InkStroke,
  point: NormalizedPagePoint,
  pageSize: PageSize,
) => {
  const screenPoint = toScreenPoint(point, pageSize);
  const segments = createStrokeSegmentList(stroke.points, pageSize);

  if (stroke.points.length === 1) {
    const singlePoint = toScreenPoint(stroke.points[0]!, pageSize);
    return Math.hypot(screenPoint.x - singlePoint.x, screenPoint.y - singlePoint.y) <=
      ERASER_HIT_RADIUS;
  }

  return segments.some((segment) => {
    const radius = Math.max(segment.width / 2, ERASER_HIT_RADIUS);
    return distanceToSegment(screenPoint, segment) <= radius;
  });
};
