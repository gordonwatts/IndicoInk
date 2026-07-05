import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

    Object.defineProperty(window, 'indicoInk', {
      value: {
        readPdfBytes: vi.fn(),
        loadPdfWorkspaceState: vi.fn(),
        savePdfWorkspaceState: vi.fn(),
        loadDeckWorkspaceState: vi.fn(),
        saveDeckWorkspaceState: vi.fn(),
      },
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

  it('returns to the first slide from the home control', async () => {
    const onSlideMetricsChange = vi.fn();
    const scrollTo = vi.fn(function scrollToMock(
      this: HTMLElement,
      options?: ScrollToOptions,
    ) {
      this.scrollTop = options?.top ?? 0;
      this.scrollLeft = options?.left ?? 0;
    });
    const scrollContainer = document.createElement('div');
    Object.defineProperty(scrollContainer, 'scrollTo', {
      value: scrollTo,
      configurable: true,
    });
    const scrollContainerRef = {
      current: scrollContainer,
    } as React.RefObject<HTMLElement>;

    const user = userEvent.setup();

    render(
      <PdfPreview
        filePath={null}
        title="Compact test"
        onSlideMetricsChange={onSlideMetricsChange}
        scrollContainerRef={scrollContainerRef}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Home' }));

    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'smooth',
    });
    expect(onSlideMetricsChange).toHaveBeenLastCalledWith({
      currentSlideNumber: 1,
      currentPageCount: 0,
    });
  });

  it('shows a loading overlay while the PDF bytes are still pending', async () => {
    const pendingRead = new Promise<Uint8Array>(() => {});
    vi.mocked(window.indicoInk.readPdfBytes).mockReturnValueOnce(pendingRead);

    render(<PdfPreview filePath="/tmp/pending.pdf" title="Loading test" />);

    expect(
      await screen.findByText('Loading the first render now.'),
    ).toBeTruthy();
  });

  it('shows a retryable error overlay when loading the PDF fails', async () => {
    const onRetryLoad = vi.fn();
    vi.mocked(window.indicoInk.readPdfBytes).mockRejectedValueOnce(
      new Error('Timed out fetching the PDF.'),
    );

    render(
      <PdfPreview
        filePath="/tmp/broken.pdf"
        title="Error test"
        onRetryLoad={onRetryLoad}
      />,
    );

    expect(await screen.findByText('PDF preview unavailable')).toBeTruthy();
    expect(
      screen.getAllByText('Timed out fetching the PDF.').length,
    ).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });
});
