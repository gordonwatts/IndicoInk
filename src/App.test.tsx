import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      configurable: true,
      writable: true,
    });
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = vi.fn((callback) => {
      callback(performance.now());
      return 1;
    });
    window.cancelAnimationFrame = vi.fn();
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
      listAgendaTalks: vi.fn().mockResolvedValue([]),
      deleteLibraryEvent: vi.fn().mockResolvedValue(undefined),
      openLibraryEvent: vi.fn().mockResolvedValue({
        kind: 'opened',
        result: {
          conferenceId: 'conference-opened',
          title: 'Opened Indico Event',
          talkCount: 5,
          deckCount: 0,
          savedAt: Date.now(),
        },
      }),
      saveIndicoApiKey: vi.fn().mockResolvedValue(undefined),
      setTalkBookmarked: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('renders the empty library view with URL validation', async () => {
    const user = userEvent.setup();
    const openedEvent = {
      id: 'conference-opened',
      sourceUrl: 'https://indico.example.org/event/example-2026',
      title: 'Opened Indico Event',
      dates: 'June 12, 2026',
      host: 'indico.example.org',
      lastOpened: 'Opened just now',
      annotationSummary: '0 annotated slides',
      cacheStatus: 'Online only',
    };
    window.indicoInk.listLibraryEvents = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([openedEvent]);
    window.indicoInk.openLibraryEvent = vi.fn().mockResolvedValue({
      kind: 'opened',
      result: {
        conferenceId: openedEvent.id,
        title: openedEvent.title,
        talkCount: 5,
        deckCount: 0,
        savedAt: Date.now(),
      },
    });

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

    expect(screen.getByText('Use an https:// Indico event URL.')).toBeTruthy();

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

    expect(screen.queryByText('Use an https:// Indico event URL.')).toBeNull();

    await user.click(
      screen.getByRole('button', {
        name: 'Open event',
      }),
    );

    expect(window.indicoInk.openLibraryEvent).toHaveBeenCalledWith(
      'https://indico.example.org/event/example-2026',
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Event agenda',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Opened Indico Event',
      }),
    ).toBeTruthy();
  });

  it('prompts for an API key when the event requires private access', async () => {
    const user = userEvent.setup();
    const privateEvent = {
      id: 'conference-private-opened',
      sourceUrl: 'https://indico.private.example.org/event/private-2026',
      title: 'Private Indico Event',
      dates: 'June 12, 2026',
      host: 'indico.private.example.org',
      lastOpened: 'Opened just now',
      annotationSummary: '0 annotated slides',
      cacheStatus: 'Online only',
    };
    window.indicoInk.listLibraryEvents = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([privateEvent]);
    window.indicoInk.openLibraryEvent = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'api-key-required',
        origin: 'https://indico.private.example.org',
        message: 'This Indico event requires an API key.',
      })
      .mockResolvedValueOnce({
        kind: 'opened',
        result: {
          conferenceId: privateEvent.id,
          title: privateEvent.title,
          talkCount: 3,
          deckCount: 0,
          savedAt: Date.now(),
        },
      });

    render(<App />);

    await user.type(
      screen.getByRole('textbox', {
        name: 'Event URL',
      }),
      'https://indico.private.example.org/event/private-2026',
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Open event',
      }),
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Private event',
      }),
    ).toBeTruthy();

    await user.type(screen.getByLabelText('API key'), 'secret-api-key');
    await user.click(
      screen.getByRole('button', {
        name: 'Save key',
      }),
    );

    expect(window.indicoInk.saveIndicoApiKey).toHaveBeenCalledWith(
      'https://indico.private.example.org',
      'secret-api-key',
    );
    expect(window.indicoInk.openLibraryEvent).toHaveBeenLastCalledWith(
      'https://indico.private.example.org/event/private-2026',
      'secret-api-key',
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Event agenda',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Private Indico Event',
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
    const agendaTalks = [
      {
        id: 'talk-1',
        conferenceId: libraryEvent.id,
        contributionId: 'contribution-1',
        sortStartsAt: Date.UTC(2026, 5, 12, 9, 0, 0, 0),
        dayLabel: 'Friday, June 12, 2026',
        title: 'Designing a calm note-taking workflow',
        speaker: 'Ada Lovelace',
        sessionTitle: 'Opening keynote',
        timeRangeLabel: '09:00 - 09:45',
        room: 'Auditorium A',
        bookmarked: true,
        materialSummary: 'PDF',
        annotatedSlideCount: 3,
      },
      {
        id: 'talk-2',
        conferenceId: libraryEvent.id,
        contributionId: 'contribution-2',
        sortStartsAt: Date.UTC(2026, 5, 12, 9, 45, 0, 0),
        dayLabel: 'Friday, June 12, 2026',
        title: 'Tracking talks across a conference',
        speaker: 'Grace Hopper',
        sessionTitle: 'Opening keynote',
        timeRangeLabel: '09:45 - 10:30',
        room: 'Auditorium A',
        bookmarked: false,
        materialSummary: '2 PDFs',
        annotatedSlideCount: 1,
      },
    ];
    window.indicoInk.listLibraryEvents = vi
      .fn()
      .mockResolvedValue([libraryEvent]);
    window.indicoInk.listAgendaTalks = vi.fn().mockResolvedValue(agendaTalks);

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
    expect(
      screen.getByRole('button', {
        name: 'Friday, June 12, 2026',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Previous day',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Next day',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bookmarked' })).toBeTruthy();
    expect(
      screen.getByText('Annotated', { selector: '.segmented-control-option' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Slides available' }),
    ).toBeTruthy();
    expect(
      await screen.findByText('Designing a calm note-taking workflow'),
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

  it('preserves the approximate scroll position for each agenda day', async () => {
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
    const agendaTalks = [
      {
        id: 'talk-1',
        conferenceId: libraryEvent.id,
        contributionId: 'contribution-1',
        sortStartsAt: Date.UTC(2026, 5, 12, 9, 0, 0, 0),
        dayLabel: 'Friday, June 12, 2026',
        title: 'Designing a calm note-taking workflow',
        speaker: 'Ada Lovelace',
        sessionTitle: 'Opening keynote',
        timeRangeLabel: '09:00 - 09:45',
        room: 'Auditorium A',
        bookmarked: true,
        materialSummary: 'PDF',
        annotatedSlideCount: 3,
      },
      {
        id: 'talk-2',
        conferenceId: libraryEvent.id,
        contributionId: 'contribution-2',
        sortStartsAt: Date.UTC(2026, 5, 12, 9, 45, 0, 0),
        dayLabel: 'Friday, June 12, 2026',
        title: 'Tracking talks across a conference',
        speaker: 'Grace Hopper',
        sessionTitle: 'Opening keynote',
        timeRangeLabel: '09:45 - 10:30',
        room: 'Auditorium A',
        bookmarked: false,
        materialSummary: '2 PDFs',
        annotatedSlideCount: 1,
      },
      {
        id: 'talk-3',
        conferenceId: libraryEvent.id,
        contributionId: 'contribution-3',
        sortStartsAt: Date.UTC(2026, 5, 13, 10, 15, 0, 0),
        dayLabel: 'Saturday, June 13, 2026',
        title: 'Keeping the agenda state in sync',
        speaker: 'Katherine Johnson',
        sessionTitle: 'Midday session',
        timeRangeLabel: '10:15 - 11:00',
        room: 'Auditorium B',
        bookmarked: false,
        materialSummary: 'No slides',
        annotatedSlideCount: 0,
      },
    ];
    window.indicoInk.listLibraryEvents = vi
      .fn()
      .mockResolvedValue([libraryEvent]);
    window.indicoInk.listAgendaTalks = vi.fn().mockResolvedValue(agendaTalks);

    render(<App />);

    await user.click(
      await screen.findByRole('button', {
        name: `Open ${libraryEvent.title}`,
      }),
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Bookmark talk',
      }),
    );

    expect(window.indicoInk.setTalkBookmarked).toHaveBeenCalledWith(
      'talk-2',
      true,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Bookmarked',
      }),
    );

    window.scrollY = 420;
    await user.click(
      screen.getByRole('button', {
        name: 'Next day',
      }),
    );

    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      behavior: 'auto',
    });

    window.scrollY = 125;
    await user.click(
      screen.getByRole('button', {
        name: 'Previous day',
      }),
    );

    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 420,
      behavior: 'auto',
    });
    expect(
      screen
        .getByRole('button', {
          name: 'Bookmarked',
        })
        .getAttribute('aria-pressed'),
    ).toBe('true');
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

    expect(await screen.findByText('No saved events yet')).toBeTruthy();
    expect(window.indicoInk.deleteLibraryEvent).toHaveBeenCalledWith(
      libraryEvent.id,
    );
  });
});
