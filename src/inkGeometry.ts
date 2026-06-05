export type PageSize = {
  width: number;
  height: number;
};

export type PointTime = {
  time: number;
};

export type PointPressure = {
  pressure: number;
};

export type ScreenPoint = {
  x: number;
  y: number;
} & PointPressure &
  PointTime;

export type NormalizedPagePoint = {
  x: number;
  y: number;
} & PointPressure &
  PointTime;

const normalizeAxis = (value: number, size: number) => value / size;

const denormalizeAxis = (value: number, size: number) => value * size;

const assertValidPageSize = (pageSize: PageSize) => {
  if (pageSize.width <= 0 || pageSize.height <= 0) {
    throw new Error('Page size must be greater than zero.');
  }
};

export const toNormalizedPagePoint = (
  point: ScreenPoint,
  pageSize: PageSize,
): NormalizedPagePoint => {
  assertValidPageSize(pageSize);

  return {
    x: normalizeAxis(point.x, pageSize.width),
    y: normalizeAxis(point.y, pageSize.height),
    pressure: point.pressure,
    time: point.time,
  };
};

export const toScreenPoint = (
  point: NormalizedPagePoint,
  pageSize: PageSize,
): ScreenPoint => {
  assertValidPageSize(pageSize);

  return {
    x: denormalizeAxis(point.x, pageSize.width),
    y: denormalizeAxis(point.y, pageSize.height),
    pressure: point.pressure,
    time: point.time,
  };
};
