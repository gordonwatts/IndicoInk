import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    window.indicoInk = {
      getAppInfo: vi.fn().mockResolvedValue({
        appName: 'IndicoInk',
        appVersion: '0.1.0',
        electronVersion: '42.3.2',
      }),
      openPdf: vi.fn().mockResolvedValue({
        canceled: true,
        filePath: null,
      }),
      readPdfBytes: vi.fn().mockResolvedValue(new Uint8Array()),
      loadPdfWorkspaceState: vi.fn().mockResolvedValue(null),
      savePdfWorkspaceState: vi.fn().mockResolvedValue({
        sourceUrl: '',
        pageCount: 0,
        savedAt: Date.now(),
      }),
      listLibraryEvents: vi.fn().mockResolvedValue([]),
      deleteLibraryEvent: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('renders the empty library view with URL validation', async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(
      screen.getByRole('button', {
        name: 'Library',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Agenda',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Bookmarks',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Annotated',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Settings',
      }),
    ).toBeTruthy();

    expect(
      screen.getByRole('heading', {
        name: 'Open a conference event',
      }),
    ).toBeTruthy();

    expect(
      screen.getByRole('button', {
        name: 'Open event',
      }),
    ).toBeTruthy();
    expect(screen.getByText('No saved events yet')).toBeTruthy();

    await user.type(
      screen.getByRole('textbox', {
        name: 'Event URL',
      }),
      'http://example.com/not-an-indico-event',
    );

    expect(
      screen.getByText('Use an https:// Indico event URL.'),
    ).toBeTruthy();

    await user.clear(
      screen.getByRole('textbox', {
        name: 'Event URL',
      }),
    );
    await user.type(
      screen.getByRole('textbox', {
        name: 'Event URL',
      }),
      'https://indico.example.org/event/example-2026',
    );

    expect(
      screen.queryByText('Use an https:// Indico event URL.'),
    ).toBeNull();

    await user.click(
      screen.getByRole('button', {
        name: 'Open event',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Event agenda',
      }),
    ).toBeTruthy();
  });

  it('supports keyboard navigation into the shell destinations', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: 'Library',
      }),
    );

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: 'Agenda',
      }),
    );

    await user.keyboard('{Enter}');

    expect(
      screen.getByRole('heading', {
        name: 'Event agenda',
      }),
    ).toBeTruthy();
  });

  it('opens a stored library event and preserves it when returning to Library', async () => {
    const user = userEvent.setup();
    const libraryEvent = {
      id: 'conference-1',
      sourceUrl: 'https://indico.example.org/event/indico-1',
      title: 'IndicoInk Small Event 2026',
      dates: 'June 12, 2026',
      host: 'small.indico.example.org',
      lastOpened: 'Opened just now',
      annotationSummary: '12 annotated slides',
      cacheStatus: 'Cached for offline use',
    };
    window.indicoInk.listLibraryEvents = vi
      .fn()
      .mockResolvedValue([libraryEvent]);

    render(<App />);

    expect(
      await screen.findByRole('button', {
        name: `Open ${libraryEvent.title}`,
      }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: `Open ${libraryEvent.title}`,
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Event agenda',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: libraryEvent.title,
      }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: 'Back',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Open a conference event',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(libraryEvent.title, {
        selector: '.nav-rail-foot strong',
      }),
    ).toBeTruthy();
  });

  it('confirms deletion before removing a stored library event', async () => {
    const user = userEvent.setup();
    const libraryEvent = {
      id: 'conference-1',
      sourceUrl: 'https://indico.example.org/event/indico-1',
      title: 'IndicoInk Small Event 2026',
      dates: 'June 12, 2026',
      host: 'small.indico.example.org',
      lastOpened: 'Opened just now',
      annotationSummary: '12 annotated slides',
      cacheStatus: 'Cached for offline use',
    };
    window.indicoInk.listLibraryEvents = vi
      .fn()
      .mockResolvedValueOnce([libraryEvent])
      .mockResolvedValueOnce([]);

    render(<App />);

    await user.click(
      await screen.findByRole('button', {
        name: `Delete ${libraryEvent.title}`,
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Delete event',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(libraryEvent.title, {
        selector: '.dialog-surface strong',
      }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: 'Delete event',
      }),
    );

    expect(
      await screen.findByText('No saved events yet'),
    ).toBeTruthy();
    expect(window.indicoInk.deleteLibraryEvent).toHaveBeenCalledWith(
      libraryEvent.id,
    );
  });
});
