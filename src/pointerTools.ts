export type PointerTool =
  | 'mouse'
  | 'pen'
  | 'eraser'
  | 'touch'
  | 'text'
  | 'unknown';

export type PointerInteractionMode = 'draw' | 'erase' | 'pan' | 'text' | 'none';

export type PointerSample = {
  pointerType: string;
  button: number;
  buttons: number;
  pressure: number;
  isPrimary: boolean;
};

export type PointerEventKind =
  | 'pointerenter'
  | 'pointermove'
  | 'pointerdown'
  | 'pointerup'
  | 'pointercancel'
  | 'pointerleave';

export type PointerToolState = {
  resolvedTool: PointerTool;
  latchedTool: PointerTool | null;
  renderedTool: PointerTool;
};

const isPenEraserContact = (sample: PointerSample) =>
  sample.pointerType === 'pen' &&
  (sample.button === 5 || (sample.buttons & 32) !== 0);

export const resolvePointerTool = (sample: PointerSample): PointerTool => {
  if (sample.pointerType === 'mouse') {
    return 'mouse';
  }

  if (sample.pointerType === 'touch') {
    return 'touch';
  }

  if (sample.pointerType === 'pen') {
    return isPenEraserContact(sample) ? 'eraser' : 'pen';
  }

  return 'unknown';
};

export const latchPointerTool = (
  previousLatchedTool: PointerTool | null,
  eventKind: PointerEventKind,
  resolvedTool: PointerTool,
): PointerTool | null => {
  if (eventKind === 'pointerup' || eventKind === 'pointercancel') {
    return null;
  }

  if (eventKind === 'pointerdown') {
    return resolvedTool === 'unknown' ? previousLatchedTool : resolvedTool;
  }

  return previousLatchedTool;
};

export const getRenderedPointerTool = (
  resolvedTool: PointerTool,
  latchedTool: PointerTool | null,
): PointerTool => latchedTool ?? resolvedTool;

export const getPointerCursor = (tool: PointerTool) => {
  switch (tool) {
    case 'mouse':
      return 'crosshair';
    case 'text':
      return 'text';
    case 'pen':
    case 'eraser':
    case 'touch':
      return 'none';
    default:
      return 'default';
  }
};

export const getPointerOverlayClass = (tool: PointerTool) =>
  `ink-layer ${tool}`;

export const getPointerInteractionMode = (
  tool: PointerTool,
): PointerInteractionMode => {
  switch (tool) {
    case 'mouse':
    case 'pen':
      return 'draw';
    case 'eraser':
      return 'erase';
    case 'text':
      return 'text';
    case 'touch':
      return 'pan';
    default:
      return 'none';
  }
};

export const isContactTool = (tool: PointerTool) =>
  tool === 'mouse' || tool === 'pen' || tool === 'eraser';

export const createPointerToolState = (
  sample: PointerSample,
  eventKind: PointerEventKind,
  previousLatchedTool: PointerTool | null,
): PointerToolState => {
  const resolvedTool = resolvePointerTool(sample);
  const latchedTool = latchPointerTool(
    previousLatchedTool,
    eventKind,
    resolvedTool,
  );

  return {
    resolvedTool,
    latchedTool,
    renderedTool: getRenderedPointerTool(resolvedTool, latchedTool),
  };
};
