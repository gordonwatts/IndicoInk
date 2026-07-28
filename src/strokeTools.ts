import {
  toScreenPoint,
  type NormalizedPagePoint,
  type PageSize,
} from './inkGeometry';

export type InkStroke = {
  id: string;
  pageNumber: number;
  /** The stroke width in the PDF page's native coordinate system. */
  baseWidth?: number;
  points: NormalizedPagePoint[];
};

export type StrokeSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
};

type StrokeSegmentCacheEntry = {
  width: number;
  height: number;
  baseWidth: number;
  pointCount: number;
  lastPoint: NormalizedPagePoint | undefined;
  segments: StrokeSegment[];
};

export type StrokeSegmentCache = {
  clear: () => void;
  get: (stroke: InkStroke, pageSize: PageSize) => StrokeSegment[];
};

export const DEFAULT_PEN_THICKNESS = 2;
export const MIN_PEN_THICKNESS = 1;
export const MAX_PEN_THICKNESS = 8;
export const STROKE_PRESSURE_SCALE = 0.5;
export const ERASER_HIT_RADIUS = 12;

export const getFitWidthNormalizedPenWidth = (
  desiredScreenWidth: number,
  fitWidthViewportWidth: number,
  pdfPageWidth: number,
) =>
  fitWidthViewportWidth > 0 && pdfPageWidth > 0
    ? desiredScreenWidth / (fitWidthViewportWidth / pdfPageWidth)
    : desiredScreenWidth;

export const getStrokeWidth = (
  pressure: number,
  baseWidth = DEFAULT_PEN_THICKNESS,
) =>
  baseWidth * (1 + Math.max(0, Math.min(pressure, 1)) * STROKE_PRESSURE_SCALE);

export const createStrokeSegmentList = (
  points: NormalizedPagePoint[],
  pageSize: PageSize,
  baseWidth = DEFAULT_PEN_THICKNESS,
): StrokeSegment[] => {
  if (points.length < 2 || pageSize.width <= 0 || pageSize.height <= 0) {
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
      width:
        (getStrokeWidth(previousPoint.pressure, baseWidth) +
          getStrokeWidth(point.pressure, baseWidth)) /
        2,
    };
  });
};

export const createStrokeSegmentCache = (): StrokeSegmentCache => {
  const entries = new Map<string, StrokeSegmentCacheEntry>();

  return {
    clear: () => entries.clear(),
    get: (stroke, pageSize) => {
      const baseWidth = stroke.baseWidth ?? DEFAULT_PEN_THICKNESS;
      const cached = entries.get(stroke.id);
      const canAppend =
        cached !== undefined &&
        cached.width === pageSize.width &&
        cached.height === pageSize.height &&
        cached.baseWidth === baseWidth &&
        cached.pointCount > 0 &&
        cached.pointCount <= stroke.points.length &&
        stroke.points[cached.pointCount - 1] === cached.lastPoint;

      if (canAppend) {
        if (cached.pointCount === stroke.points.length) {
          return cached.segments;
        }

        const appendedSegments = createStrokeSegmentList(
          stroke.points.slice(cached.pointCount - 1),
          pageSize,
          baseWidth,
        );
        cached.segments.push(...appendedSegments);
        cached.pointCount = stroke.points.length;
        cached.lastPoint = stroke.points.at(-1);
        return cached.segments;
      }

      const segments = createStrokeSegmentList(
        stroke.points,
        pageSize,
        baseWidth,
      );
      entries.set(stroke.id, {
        width: pageSize.width,
        height: pageSize.height,
        baseWidth,
        pointCount: stroke.points.length,
        lastPoint: stroke.points.at(-1),
        segments,
      });
      return segments;
    },
  };
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
  segmentCache?: StrokeSegmentCache,
) => {
  if (pageSize.width <= 0 || pageSize.height <= 0) {
    return false;
  }

  const screenPoint = toScreenPoint(point, pageSize);
  const segments = segmentCache
    ? segmentCache.get(stroke, pageSize)
    : createStrokeSegmentList(
        stroke.points,
        pageSize,
        stroke.baseWidth ?? DEFAULT_PEN_THICKNESS,
      );

  if (stroke.points.length === 1) {
    const singlePoint = toScreenPoint(stroke.points[0]!, pageSize);
    return (
      Math.hypot(
        screenPoint.x - singlePoint.x,
        screenPoint.y - singlePoint.y,
      ) <= ERASER_HIT_RADIUS
    );
  }

  return segments.some((segment) => {
    const radius = Math.max(segment.width / 2, ERASER_HIT_RADIUS);
    return distanceToSegment(screenPoint, segment) <= radius;
  });
};
