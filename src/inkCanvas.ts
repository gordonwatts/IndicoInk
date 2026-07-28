import type { NormalizedPagePoint, PageSize } from './inkGeometry';
import {
  createStrokeSegmentList,
  DEFAULT_PEN_THICKNESS,
  getStrokeWidth,
  type InkStroke,
} from './strokeTools';

export type InkCanvasMetrics = {
  displayWidth: number;
  displayHeight: number;
  pageSize: PageSize;
  devicePixelRatio?: number;
};

const getDevicePixelRatio = (override?: number) =>
  Math.max(1, override ?? globalThis.devicePixelRatio ?? 1);

export const sizeInkCanvas = (
  canvas: HTMLCanvasElement,
  metrics: InkCanvasMetrics,
) => {
  const dpr = getDevicePixelRatio(metrics.devicePixelRatio);
  const pixelWidth = Math.max(1, Math.round(metrics.displayWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(metrics.displayHeight * dpr));

  if (canvas.width !== pixelWidth) {
    canvas.width = pixelWidth;
  }
  if (canvas.height !== pixelHeight) {
    canvas.height = pixelHeight;
  }
  const cssWidth = `${metrics.displayWidth}px`;
  const cssHeight = `${metrics.displayHeight}px`;
  if (canvas.style.width !== cssWidth) {
    canvas.style.width = cssWidth;
  }
  if (canvas.style.height !== cssHeight) {
    canvas.style.height = cssHeight;
  }

  return { dpr, pixelWidth, pixelHeight };
};

const prepareContext = (
  canvas: HTMLCanvasElement,
  metrics: InkCanvasMetrics,
  clear: boolean,
) => {
  const { dpr, pixelWidth, pixelHeight } = sizeInkCanvas(canvas, metrics);
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  if (clear) {
    context.clearRect(0, 0, pixelWidth, pixelHeight);
  }
  context.setTransform(
    (dpr * metrics.displayWidth) / Math.max(1, metrics.pageSize.width),
    0,
    0,
    (dpr * metrics.displayHeight) / Math.max(1, metrics.pageSize.height),
    0,
    0,
  );
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#111111';
  context.fillStyle = '#111111';
  return context;
};

export const clearInkCanvas = (
  canvas: HTMLCanvasElement | null | undefined,
  metrics: InkCanvasMetrics,
) => {
  if (!canvas) {
    return;
  }
  prepareContext(canvas, metrics, true);
};

export const drawInkStroke = (
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  stroke: InkStroke,
  pageSize: PageSize,
) => {
  const points = Array.isArray(stroke.points) ? stroke.points : [];
  const baseWidth = stroke.baseWidth ?? DEFAULT_PEN_THICKNESS;
  if (points.length === 1) {
    const point = points[0]!;
    context.beginPath();
    context.arc(
      point.x * pageSize.width,
      point.y * pageSize.height,
      getStrokeWidth(point.pressure, baseWidth) / 2,
      0,
      Math.PI * 2,
    );
    context.fill();
    return;
  }

  for (const segment of createStrokeSegmentList(points, pageSize, baseWidth)) {
    context.beginPath();
    context.lineWidth = segment.width;
    context.moveTo(segment.x1, segment.y1);
    context.lineTo(segment.x2, segment.y2);
    context.stroke();
  }
};

export const rebuildInkCanvas = (
  canvas: HTMLCanvasElement,
  strokes: InkStroke[],
  metrics: InkCanvasMetrics,
) => {
  const context = prepareContext(canvas, metrics, true);
  if (!context) {
    return;
  }
  for (const stroke of strokes) {
    drawInkStroke(context, stroke, metrics.pageSize);
  }
};

export const drawInkPoints = (
  canvas: HTMLCanvasElement | null | undefined,
  points: NormalizedPagePoint[],
  baseWidth: number,
  metrics: InkCanvasMetrics,
  clear = false,
) => {
  if (!canvas || !points.length) {
    return;
  }
  const context = prepareContext(canvas, metrics, clear);
  if (!context) {
    return;
  }
  drawInkStroke(
    context,
    {
      id: 'active',
      pageNumber: 0,
      baseWidth,
      points,
    },
    metrics.pageSize,
  );
};

export const dropExactDuplicatePoints = (
  existingLastPoint: NormalizedPagePoint | undefined,
  samples: NormalizedPagePoint[],
) => {
  const unique: NormalizedPagePoint[] = [];
  let previous = existingLastPoint;
  for (const sample of samples) {
    if (
      previous &&
      previous.x === sample.x &&
      previous.y === sample.y &&
      previous.pressure === sample.pressure &&
      previous.time === sample.time
    ) {
      continue;
    }
    unique.push(sample);
    previous = sample;
  }
  return unique;
};
