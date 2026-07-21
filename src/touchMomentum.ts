export type TouchPanSample = {
  x: number;
  y: number;
  time: number;
};

export type TouchMomentumVelocity = {
  x: number;
  y: number;
};

export type TouchMomentumBounds = {
  maxX: number;
  maxY: number;
};

export type TouchMomentumStep = {
  position: { x: number; y: number };
  velocity: TouchMomentumVelocity;
  isActive: boolean;
};

const DEFAULT_SAMPLE_WINDOW_MS = 120;
const DEFAULT_DECELERATION_PX_PER_MS2 = 0.0024;
const MIN_ACTIVE_VELOCITY_PX_PER_MS = 0.01;

export const getTouchPanVelocity = (
  samples: TouchPanSample[],
  sampleWindowMs = DEFAULT_SAMPLE_WINDOW_MS,
): TouchMomentumVelocity => {
  if (samples.length < 2) {
    return { x: 0, y: 0 };
  }

  const last = samples[samples.length - 1];
  if (!last) {
    return { x: 0, y: 0 };
  }
  const first = samples.find(
    (sample) => last.time - sample.time <= sampleWindowMs,
  );
  if (!first) {
    return { x: 0, y: 0 };
  }

  const elapsed = last.time - first.time;
  if (elapsed <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: -(last.x - first.x) / elapsed,
    y: -(last.y - first.y) / elapsed,
  };
};

const clampPosition = (
  position: number,
  maximum: number,
): { value: number; hitBoundary: boolean } => {
  const value = Math.max(0, Math.min(maximum, position));
  return { value, hitBoundary: value !== position };
};

const slowVelocity = (
  velocity: number,
  elapsedMs: number,
  deceleration: number,
) => {
  const amount = deceleration * elapsedMs;
  if (Math.abs(velocity) <= amount) {
    return 0;
  }
  return velocity - Math.sign(velocity) * amount;
};

export const advanceTouchMomentum = (
  position: { x: number; y: number },
  velocity: TouchMomentumVelocity,
  elapsedMs: number,
  bounds: TouchMomentumBounds,
  deceleration = DEFAULT_DECELERATION_PX_PER_MS2,
): TouchMomentumStep => {
  const nextVelocity = {
    x: slowVelocity(velocity.x, elapsedMs, deceleration),
    y: slowVelocity(velocity.y, elapsedMs, deceleration),
  };
  const nextX = clampPosition(
    position.x + nextVelocity.x * elapsedMs,
    Math.max(0, bounds.maxX),
  );
  const nextY = clampPosition(
    position.y + nextVelocity.y * elapsedMs,
    Math.max(0, bounds.maxY),
  );

  if (nextX.hitBoundary) {
    nextVelocity.x = 0;
  }
  if (nextY.hitBoundary) {
    nextVelocity.y = 0;
  }

  return {
    position: { x: nextX.value, y: nextY.value },
    velocity: nextVelocity,
    isActive:
      Math.abs(nextVelocity.x) >= MIN_ACTIVE_VELOCITY_PX_PER_MS ||
      Math.abs(nextVelocity.y) >= MIN_ACTIVE_VELOCITY_PX_PER_MS,
  };
};
