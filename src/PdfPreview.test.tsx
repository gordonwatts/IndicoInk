import React from 'react';
import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PdfPreview,
  getCoalescedPagePoints,
  getPredictedPagePoints,
  isLikelyDownloadableUrl,
  PEN_POINTER_MARKER_RADIUS,
} from './PdfPreview';

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
        loadDeckWorkspaceState: vi.fn(),
        savePdfWorkspaceChanges: vi.fn(),
        saveDeckWorkspaceChanges: vi.fn(),
        getAppSettings: vi.fn(),
        setAppSettings: vi.fn(),
      },
      configurable: true,
    });
  });

  it('shows the compact slide-note controls without jump or download chrome', async () => {
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
      screen
        .getByRole('slider', { name: 'Pen thickness' })
        .getAttribute('value'),
    ).toBe('2');
    await userEvent.click(screen.getByRole('button', { name: 'Pen color' }));
    expect(screen.getAllByRole('option')).toHaveLength(6);
    expect(screen.getByRole('option', { name: 'White' })).toBeTruthy();
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

  it('renders one transient blank notebook page without saving it', async () => {
    const onSlideMetricsChange = vi.fn();

    render(
      <PdfPreview
        filePath={null}
        blankPageMode
        workspaceDeckId="notebook-test"
        workspaceSourceUrl="indicoink://notebook/talk-test"
        conferenceId="conference-test"
        talkId="talk-test"
        onSlideMetricsChange={onSlideMetricsChange}
      />,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('.pdf-preview-page')).toHaveLength(1);
    });
    expect(onSlideMetricsChange).toHaveBeenLastCalledWith({
      currentSlideNumber: 1,
      currentPageCount: 1,
    });
    expect(window.indicoInk.saveDeckWorkspaceChanges).not.toHaveBeenCalled();
  });

  it('uses the selected pen color when committing a stroke', async () => {
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: '#111111',
      fillStyle: '#111111',
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: vi.fn(() => context),
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    });

    const user = userEvent.setup();
    render(
      <PdfPreview
        filePath={null}
        blankPageMode
        workspaceDeckId="color-test"
        workspaceSourceUrl="indicoink://notebook/color-test"
        conferenceId="conference-test"
        talkId="talk-test"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('.pdf-preview-sheet')).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: 'Pen color' }));
    await user.click(screen.getByRole('option', { name: 'Red' }));

    const sheet = document.querySelector<HTMLElement>('.pdf-preview-sheet');
    if (!sheet) {
      throw new Error('Expected a rendered PDF page sheet.');
    }
    Object.defineProperty(sheet, 'getBoundingClientRect', {
      value: () => ({
        bottom: 1100,
        height: 1100,
        left: 0,
        right: 800,
        top: 0,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
      configurable: true,
    });

    const pointerDown = createEvent.pointerDown(sheet, {
      buttons: 1,
      button: 0,
      clientX: 80,
      clientY: 110,
      pointerId: 1,
      pressure: 0.5,
    });
    Object.defineProperty(pointerDown, 'pointerType', { value: 'pen' });
    fireEvent(sheet, pointerDown);
    const pointerUp = createEvent.pointerUp(sheet, {
      buttons: 0,
      button: 0,
      clientX: 80,
      clientY: 110,
      pointerId: 1,
      pressure: 0,
    });
    Object.defineProperty(pointerUp, 'pointerType', { value: 'pen' });
    fireEvent(sheet, pointerUp);

    await waitFor(() => {
      expect(
        vi
          .mocked(window.indicoInk.saveDeckWorkspaceChanges)
          .mock.calls.some((call) => JSON.stringify(call).includes('#d13438')),
      ).toBe(true);
    });
  });

  it('keeps the pen pointer overlay point-like', () => {
    expect(PEN_POINTER_MARKER_RADIUS).toBeLessThanOrEqual(3);
  });

  it('captures every coalesced stylus sample using cached page bounds', () => {
    const event = {
      nativeEvent: {
        clientX: 140,
        clientY: 100,
        pressure: 0.7,
        timeStamp: 3,
        getCoalescedEvents: () => [
          {
            clientX: 120,
            clientY: 80,
            pressure: 0.3,
            timeStamp: 1,
          },
          {
            clientX: 130,
            clientY: 90,
            pressure: 0.5,
            timeStamp: 2,
          },
          {
            clientX: 140,
            clientY: 100,
            pressure: 0.7,
            timeStamp: 3,
          },
        ],
      },
    } as unknown as React.PointerEvent<HTMLElement>;

    expect(
      getCoalescedPagePoints(event, {
        left: 100,
        top: 60,
        width: 200,
        height: 100,
      }),
    ).toEqual([
      { x: 0.1, y: 0.2, pressure: 0.3, time: 1 },
      { x: 0.15, y: 0.3, pressure: 0.5, time: 2 },
      { x: 0.2, y: 0.4, pressure: 0.7, time: 3 },
    ]);
  });

  it('reads predictions separately from real coalesced samples', () => {
    const event = {
      nativeEvent: {
        getPredictedEvents: () => [
          {
            clientX: 150,
            clientY: 110,
            pressure: 0.8,
            timeStamp: 4,
          },
        ],
      },
    } as unknown as React.PointerEvent<HTMLElement>;

    expect(
      getPredictedPagePoints(event, {
        left: 100,
        top: 60,
        width: 200,
        height: 100,
      }),
    ).toEqual([{ x: 0.25, y: 0.5, pressure: 0.8, time: 4 }]);
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

  it('surfaces back-to-agenda and text-mode keyboard shortcuts', () => {
    const onBackToAgenda = vi.fn();

    render(
      <PdfPreview
        filePath={null}
        title="Compact test"
        onBackToAgenda={onBackToAgenda}
      />,
    );

    expect(screen.getByRole('button', { name: 'Back to agenda' })).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Back to agenda' })
        .getAttribute('title'),
    ).toBe('Back to agenda (Alt+A)');
    expect(
      screen.getByRole('button', { name: 'Text' }).getAttribute('title'),
    ).toBe('Text tool (Ctrl+T)');

    fireEvent.keyDown(window, {
      key: 't',
      ctrlKey: true,
    });

    expect(
      screen.getByRole('button', { name: 'Text' }).getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.keyDown(window, {
      key: 'a',
      altKey: true,
    });

    expect(onBackToAgenda).toHaveBeenCalledTimes(1);
  });

  it('shows a loading overlay while the PDF bytes are still pending', async () => {
    const pendingRead = new Promise<Uint8Array>(() => {});
    vi.mocked(window.indicoInk.readPdfBytes).mockReturnValueOnce(pendingRead);

    render(<PdfPreview filePath="/tmp/pending.pdf" title="Loading test" />);

    expect(await screen.findByText('Preparing a new render...')).toBeTruthy();
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

  it('only treats file-like URLs as downloadable', () => {
    expect(isLikelyDownloadableUrl('http://nytimes.com')).toBe(false);
    expect(isLikelyDownloadableUrl('http://nytimes.com/file.txt')).toBe(true);
    expect(isLikelyDownloadableUrl('https://example.com/report.pdf')).toBe(
      true,
    );
    expect(isLikelyDownloadableUrl('https://example.com/path/')).toBe(false);
  });
});
