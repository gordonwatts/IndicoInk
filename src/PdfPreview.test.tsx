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

  it('shows download progress and cancellation controls while a deck is downloading', () => {
    const onCancelDownload = vi.fn();

    render(
      <PdfPreview
        filePath={null}
        title="Download test"
        downloadStatus={{
          operationId: 'download-1',
          conferenceId: 'conference-1',
          talkId: 'talk-1',
          deckId: 'deck-1',
          sourceUrl: 'https://example.org/deck.pdf',
          displayName: 'Deck',
          filePath: 'C:/temp/deck.pdf',
          kind: 'downloading',
          bytesDownloaded: 512,
          totalBytes: 1024,
          message: null,
          updatedAt: 1700000000000,
        }}
        onCancelDownload={onCancelDownload}
      />,
    );

    expect(screen.getByText('Downloading 50%')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('shows retry controls for download failures', () => {
    const onRetryDownload = vi.fn();

    render(
      <PdfPreview
        filePath={null}
        title="Failure test"
        downloadStatus={{
          operationId: 'download-1',
          conferenceId: 'conference-1',
          talkId: 'talk-1',
          deckId: 'deck-1',
          sourceUrl: 'https://example.org/deck.pdf',
          displayName: 'Deck',
          filePath: 'C:/temp/deck.pdf',
          kind: 'error',
          bytesDownloaded: 0,
          totalBytes: null,
          message: 'Download failed.',
          updatedAt: 1700000000000,
        }}
        onRetryDownload={onRetryDownload}
      />,
    );

    expect(screen.getByText('Download failed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
