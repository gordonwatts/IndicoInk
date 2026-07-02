import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PdfPreview } from './PdfPreview';

describe('PdfPreview', () => {
  beforeEach(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    Object.defineProperty(window, 'ResizeObserver', {
      value: ResizeObserverMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: ResizeObserverMock,
      configurable: true,
    });
  });

  it('shows the compact slide-note controls without jump or download chrome', () => {
    const onSlideMetricsChange = vi.fn();

    render(
      <PdfPreview
        filePath={null}
        title="Compact test"
        onSlideMetricsChange={onSlideMetricsChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'Pen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Text' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Eraser' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Cancel download' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry download' })).toBeNull();
    expect(screen.queryByText('Jump to slide')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go' })).toBeNull();
    expect(onSlideMetricsChange).toHaveBeenCalledWith({
      currentSlideNumber: 1,
      currentPageCount: 0,
    });
  });
});
