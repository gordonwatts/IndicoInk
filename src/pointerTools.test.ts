import { describe, expect, it } from 'vitest';

import {
  createPointerToolState,
  getPointerCursor,
  getPointerInteractionMode,
  getPointerOverlayClass,
  latchPointerTool,
  resolvePointerTool,
} from './pointerTools';

describe('pointerTools', () => {
  it('resolves the expected pointer tools', () => {
    expect(
      resolvePointerTool({
        pointerType: 'mouse',
        button: 0,
        buttons: 0,
        pressure: 0,
        isPrimary: true,
      }),
    ).toBe('mouse');

    expect(
      resolvePointerTool({
        pointerType: 'pen',
        button: 0,
        buttons: 0,
        pressure: 0,
        isPrimary: true,
      }),
    ).toBe('pen');

    expect(
      resolvePointerTool({
        pointerType: 'pen',
        button: 5,
        buttons: 32,
        pressure: 0.6,
        isPrimary: true,
      }),
    ).toBe('eraser');

    expect(
      resolvePointerTool({
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        pressure: 0.4,
        isPrimary: true,
      }),
    ).toBe('touch');
  });

  it('latches contact tools and clears them on release', () => {
    expect(latchPointerTool(null, 'pointerdown', 'mouse')).toBe('mouse');
    expect(latchPointerTool(null, 'pointerdown', 'touch')).toBe('touch');
    expect(latchPointerTool('mouse', 'pointermove', 'mouse')).toBe('mouse');
    expect(latchPointerTool('mouse', 'pointerup', 'mouse')).toBeNull();
    expect(latchPointerTool('eraser', 'pointercancel', 'eraser')).toBeNull();
  });

  it('keeps diagnostics and overlay classes aligned', () => {
    const state = createPointerToolState(
      {
        pointerType: 'pen',
        button: 5,
        buttons: 32,
        pressure: 0.8,
        isPrimary: true,
      },
      'pointerdown',
      null,
    );

    expect(state.resolvedTool).toBe('eraser');
    expect(state.latchedTool).toBe('eraser');
    expect(state.renderedTool).toBe('eraser');
    expect(getPointerCursor(state.renderedTool)).toBe('none');
    expect(getPointerOverlayClass(state.renderedTool)).toBe('ink-layer eraser');
    expect(getPointerInteractionMode(state.renderedTool)).toBe('erase');
  });

  it('maps mouse, pen, touch, and unknown cursor modes explicitly', () => {
    expect(getPointerCursor('mouse')).toBe('crosshair');
    expect(getPointerCursor('pen')).toBe('none');
    expect(getPointerCursor('eraser')).toBe('none');
    expect(getPointerCursor('touch')).toBe('none');
    expect(getPointerCursor('unknown')).toBe('default');
  });
});
