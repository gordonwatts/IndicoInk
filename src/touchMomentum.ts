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
// Keep a stalled or delayed input frame from turning into an unbounded fling.
// At this cap, momentum can still travel roughly 830 px before stopping with
// the default deceleration, but it cannot skip an entire long document.
const MAX_TOUCH_PAN_VELOCITY_PX_PER_MS = 2;
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
    x: clampVelocity(-(last.x - first.x) / elapsed),
    y: clampVelocity(-(last.y - first.y) / elapsed),
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

const clampVelocity = (velocity: number): number =>
  Math.max(
    -MAX_TOUCH_PAN_VELOCITY_PX_PER_MS,
    Math.min(MAX_TOUCH_PAN_VELOCITY_PX_PER_MS, velocity),
  );

export const advanceTouchMomentum = (
  position: { x: number; y: number },
  velocity: TouchMomentumVelocity,
  elapsedMs: number,
  bounds: TouchMomentumBounds,
  deceleration = DEFAULT_DECELERATION_PX_PER_MS2,
): TouchMomentumStep => {
  const cappedVelocity = {
    x: clampVelocity(velocity.x),
    y: clampVelocity(velocity.y),
  };
  const nextVelocity = {
    x: slowVelocity(cappedVelocity.x, elapsedMs, deceleration),
    y: slowVelocity(cappedVelocity.y, elapsedMs, deceleration),
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
