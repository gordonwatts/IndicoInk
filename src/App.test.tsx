import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

let clipboardWriteTextMock: ReturnType<typeof vi.fn>;

describe('App', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      configurable: true,
      writable: true,
    });
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
    clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);
    if (navigator.clipboard) {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: clipboardWriteTextMock,
        configurable: true,
      });
    } else {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: clipboardWriteTextMock,
        },
        configurable: true,
      });
    }
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = vi.fn((callback) => {
      callback(performance.now());
      return 1;
    });
    window.cancelAnimationFrame = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      value: vi.fn(function scrollTo(
        this: HTMLElement,
        options?: ScrollToOptions,
      ) {
        this.scrollTop = options?.top ?? 0;
        this.scrollLeft = options?.left ?? 0;
      }),
      configurable: true,
    });
    window.indicoInk = {
      getAppInfo: vi.fn().mockResolvedValue({
        appName: 'IndicoInk',
        appVersion: '0.1.0',
        electronVersion: '42.3.2',
      }),
      getDataFolder: vi
        .fn()
        .mockResolvedValue('C:/Users/test/AppData/Roaming/IndicoInk'),
      getAppSettings: vi.fn().mockResolvedValue({
        recordLogging: false,
      }),
      getStartupIndicoEventUrl: vi.fn().mockResolvedValue(null),
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
      loadDeckWorkspaceState: vi.fn().mockResolvedValue(null),
      saveDeckWorkspaceState: vi.fn().mockResolvedValue({
        sourceUrl: '',
        pageCount: 0,
        savedAt: Date.now(),
      }),
      listLibraryEvents: vi.fn().mockResolvedValue([]),
      listAgendaTalks: vi.fn().mockResolvedValue([]),
      deleteLibraryEvent: vi.fn().mockResolvedValue(undefined),
      refreshLibraryEvent: vi.fn().mockResolvedValue({
        kind: 'refreshed',
        conferenceId: 'conference-opened',
        title: 'Opened Indico Event',
        talkCount: 5,
        deckCount: 0,
        changedTalkCount: 0,
        removedTalkCount: 0,
        newlyAvailableDeckCount: 0,
      }),
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
      listIndicoApiKeys: vi.fn().mockResolvedValue([]),
      deleteIndicoApiKey: vi.fn().mockResolvedValue(undefined),
      setTalkBookmarked: vi.fn().mockResolvedValue(undefined),
      setSelectedDeck: vi.fn().mockResolvedValue(undefined),
      openTalkDeck: vi.fn().mockResolvedValue({
        kind: 'ready',
        conferenceId: 'conference-opened',
        talkId: 'talk-opened',
        deckId: 'deck-opened',
        sourceUrl: 'https://indico.example.org/materials/deck.pdf',
        displayName: 'Deck',
        filePath: 'C:/temp/deck.pdf',
        pageCount: 10,
      }),
      getDeckDownloadStatus: vi.fn().mockResolvedValue(null),
      cancelDeckDownload: vi.fn().mockResolvedValue(undefined),
      openExternalUrl: vi.fn().mockResolvedValue(undefined),
      openDataFolder: vi.fn().mockResolvedValue(undefined),
      getConferenceExportSnapshot: vi.fn().mockResolvedValue(null),
      setAppSettings: vi.fn().mockResolvedValue({
        recordLogging: false,
      }),
      showExportSaveDialog: vi.fn().mockResolvedValue({
        canceled: true,
        filePath: null,
      }),
      writeExportFile: vi.fn().mockResolvedValue(undefined),
      openExportFileLocation: vi.fn().mockResolvedValue(undefined),
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
      .mockResolvedValue([openedEvent]);
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
        name: 'Bookmarks',
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agenda' })).toBeNull();
    expect(
      within(
        screen.getByRole('navigation', { name: 'Destinations' }),
      ).getByRole('button', { name: 'Annotated' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Settings',
      }),
    ).toBeTruthy();

    expect(
      screen.getByRole('heading', {
        name: 'Open an event',
        level: 1,
      }),
    ).toBeTruthy();

    expect(
      screen.getByRole('button', {
        name: 'Open event',
      }),
    ).toBeTruthy();
    expect(screen.getByText('No saved events yet')).toBeTruthy();
    expect(screen.queryByText('V1 shell')).toBeNull();
    expect(screen.queryByText('Current event')).toBeNull();
    expect(screen.queryByText('Library view')).toBeNull();
    expect(
      screen.queryAllByRole('button', {
        name: 'Refresh',
      }),
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole('button', {
        name: 'Export notes',
      }),
    ).toHaveLength(0);
    expect(document.querySelectorAll('.event-list .is-selected')).toHaveLength(
      0,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Settings',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Application settings',
      }),
    ).toBeTruthy();
    expect(screen.getByText('App version')).toBeTruthy();
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('Electron version')).toBeTruthy();
    expect(screen.getByText('42.3.2')).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: 'Back to library',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Open an event',
        level: 1,
      }),
    ).toBeTruthy();

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
        name: 'Opened Indico Event',
        level: 1,
      }),
    ).toBeTruthy();
    expect(screen.getByText('indico.example.org')).toBeTruthy();
    expect(screen.getByText('Online only')).toBeTruthy();
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
        name: 'Private Indico Event',
        level: 1,
      }),
    ).toBeTruthy();
    expect(screen.getByText('indico.private.example.org')).toBeTruthy();
    expect(screen.getByText('Online only')).toBeTruthy();
  });

  it('lists and deletes saved Indico API keys from Settings', async () => {
    const user = userEvent.setup();
    window.indicoInk.listIndicoApiKeys = vi
      .fn()
      .mockResolvedValueOnce([
        {
          origin: 'https://indico.cern.ch',
          updatedAt: Date.UTC(2026, 5, 27, 10, 30, 0, 0),
        },
      ])
      .mockResolvedValueOnce([]);

    render(<App />);

    await user.click(
      screen.getByRole('button', {
        name: 'Settings',
      }),
    );

    expect(await screen.findByText('https://indico.cern.ch')).toBeTruthy();
    expect(screen.getByText(/Saved/)).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: 'Delete API key for https://indico.cern.ch',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Delete key',
      }),
    );

    expect(window.indicoInk.deleteIndicoApiKey).toHaveBeenCalledWith(
      'https://indico.cern.ch',
    );
  });

  it('prompts for an API key when a slide download requires private access', async () => {
    const user = userEvent.setup();
    const libraryEvent = {
      id: 'conference-private-deck',
      sourceUrl: 'https://indico.cern.ch/event/1649690',
      title: 'Private Deck Event',
      dates: 'June 12, 2026',
      host: 'indico.cern.ch',
      lastOpened: 'Opened just now',
      annotationSummary: '0 annotated slides',
      cacheStatus: 'Online only',
    };
    const agendaTalks = [
      {
        id: 'talk-private-deck',
        conferenceId: libraryEvent.id,
        contributionId: 'private-deck',
        sortStartsAt: Date.UTC(2026, 5, 12, 9, 0, 0, 0),
        dayLabel: 'Friday, June 12, 2026',
        title: 'Private slide materials',
        speaker: 'Ada Lovelace',
        sessionTitle: 'Closed session',
        timeRangeLabel: '09:00 - 09:30',
        room: 'Auditorium',
        bookmarked: false,
        materialSummary: '1 PDF',
        materials: [
          {
            id: 'deck-private',
            title: 'Private deck',
            sourceUrl: 'https://indico.cern.ch/materials/private.pdf',
            mimeType: 'application/pdf',
            selected: true,
            pageCount: 12,
          },
        ],
        annotatedSlideCount: 0,
      },
    ];
    window.indicoInk.listLibraryEvents = vi
      .fn()
      .mockResolvedValue([libraryEvent]);
    window.indicoInk.listAgendaTalks = vi.fn().mockResolvedValue(agendaTalks);
    window.indicoInk.openTalkDeck = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'api-key-required',
        conferenceId: libraryEvent.id,
        talkId: 'talk-private-deck',
        deckId: 'deck-private',
        sourceUrl: 'https://indico.cern.ch/materials/private.pdf',
        displayName: 'Private deck',
        filePath: 'C:/temp/private.pdf',
        pageCount: 0,
        operationId: null,
        origin: 'https://indico.cern.ch',
        message: 'This Indico slide deck requires an API key.',
      })
      .mockResolvedValueOnce({
        kind: 'ready',
        conferenceId: libraryEvent.id,
        talkId: 'talk-private-deck',
        deckId: 'deck-private',
        sourceUrl: 'https://indico.cern.ch/materials/private.pdf',
        displayName: 'Private deck',
        filePath: 'C:/temp/private.pdf',
        pageCount: 12,
      });

    render(<App />);

    await user.click(
      await screen.findByRole('button', {
        name: `Open ${libraryEvent.title}`,
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Open talk for Private slide materials',
      }),
    );

    expect(await screen.findByLabelText('API key')).toBeTruthy();

    await user.type(screen.getByLabelText('API key'), 'secret-api-key');
    await user.click(
      screen.getByRole('button', {
        name: 'Save key',
      }),
    );

    expect(window.indicoInk.saveIndicoApiKey).toHaveBeenCalledWith(
      'https://indico.cern.ch',
      'secret-api-key',
    );
    expect(window.indicoInk.openTalkDeck).toHaveBeenLastCalledWith(
      libraryEvent.id,
      'talk-private-deck',
      'deck-private',
    );
    expect(
      await screen.findByRole('button', {
        name: 'Home',
      }),
    ).toBeTruthy();
  }, 20_000);

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
        name: 'Search',
      }),
    );

    await user.keyboard('{Enter}');

    expect(
      screen.getByRole('heading', {
        name: 'Search talks',
        level: 1,
      }),
    ).toBeTruthy();
  });

  it('shows shortcut hints and routes Ctrl+F and Alt+L', async () => {
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
        materials: [
          {
            id: 'deck-1',
            title: 'Opening slides',
            sourceUrl: 'https://indico.example.org/materials/deck-1.pdf',
            mimeType: 'application/pdf',
            selected: true,
            pageCount: 10,
          },
        ],
        annotatedSlideCount: 3,
      },
    ];

    window.indicoInk.listLibraryEvents = vi
      .fn()
      .mockResolvedValue([libraryEvent]);
    window.indicoInk.listAgendaTalks = vi.fn().mockResolvedValue(agendaTalks);
    window.indicoInk.openLibraryEvent = vi.fn().mockResolvedValue({
      kind: 'opened',
      result: {
        conferenceId: libraryEvent.id,
        title: libraryEvent.title,
        talkCount: agendaTalks.length,
        deckCount: 1,
        savedAt: Date.now(),
      },
    });

    render(<App />);

    await user.click(
      await screen.findByRole('button', {
        name: `Open ${libraryEvent.title}`,
      }),
    );

    expect(
      screen.getByRole('button', {
        name: 'Library',
      }).getAttribute('title'),
    ).toBe('Library (Alt+L)');
    expect(
      screen.getByRole('button', {
        name: 'Search',
      }).getAttribute('title'),
    ).toBe('Search (Ctrl+F)');

    await screen.findByRole('heading', {
      name: libraryEvent.title,
      level: 1,
    });

    fireEvent.keyDown(window, {
      key: 'f',
      ctrlKey: true,
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Search talks',
        level: 2,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('searchbox', {
        name: 'Search talks',
      }),
    ).toBe(document.activeElement);

    fireEvent.keyDown(window, {
      key: 'l',
      altKey: true,
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Open an event',
        level: 1,
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
        materials: [
          {
            id: 'deck-1',
            title: 'Opening slides',
            sourceUrl: 'https://indico.example.org/materials/deck-1.pdf',
            mimeType: 'application/pdf',
            selected: true,
            pageCount: 10,
          },
        ],
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
        materials: [
          {
            id: 'deck-2a',
            title: 'Main deck',
            sourceUrl: 'https://indico.example.org/materials/deck-2a.pdf',
            mimeType: 'application/pdf',
            selected: true,
            pageCount: 8,
          },
          {
            id: 'deck-2b',
            title: 'Supplementary deck',
            sourceUrl: 'https://indico.example.org/materials/deck-2b.pdf',
            mimeType: 'application/pdf',
            selected: false,
            pageCount: 3,
          },
        ],
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
        name: libraryEvent.title,
        level: 1,
      }),
    ).toBeTruthy();
    expect(screen.getByText('2 talks shown')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Fri Jun 12',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText('Jun 12, 2026', {
        selector: '.command-title-meta',
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
      within(
        screen.getByRole('navigation', { name: 'Destinations' }),
      ).getByRole('button', { name: 'Annotated' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Annotated', { selector: '.segmented-control-option' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Slides available' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Open talk for Designing a calm note-taking workflow',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Open URL for IndicoInk Small Event 2026',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Copy URL for IndicoInk Small Event 2026',
      }),
    ).toBeTruthy();

    const pageSurface = document.querySelector<HTMLElement>('.page-surface');
    expect(pageSurface).toBeTruthy();
    pageSurface!.scrollTop = 248;
    pageSurface!.scrollLeft = 36;
    fireEvent.scroll(pageSurface!);

    await user.click(
      screen.getByRole('button', {
        name: 'Open URL for IndicoInk Small Event 2026',
      }),
    );
    expect(window.indicoInk.openExternalUrl).toHaveBeenCalledWith(
      libraryEvent.sourceUrl,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Copy URL for IndicoInk Small Event 2026',
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('Copied to clipboard')).toBeTruthy();
    });
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      libraryEvent.sourceUrl,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Open talk for Designing a calm note-taking workflow',
      }),
    );

    expect(
      await screen.findByRole('button', {
        name: 'Home',
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', {
        name: 'Slide Notes',
      }),
    ).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Back to agenda',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Back to agenda',
      }).getAttribute('title'),
    ).toBe('Back to agenda (Alt+A)');

    await user.click(
      screen.getByRole('button', {
        name: 'Back to agenda',
      }),
    );

    expect(pageSurface!.scrollTop).toBe(248);
    expect(pageSurface!.scrollLeft).toBe(36);

    const firstBookmarkButton = screen.getAllByRole('button', {
      name: 'Bookmark talk',
    })[0];
    expect(firstBookmarkButton).toBeTruthy();
    await user.click(firstBookmarkButton!);

    await user.click(
      screen.getByRole('button', {
        name: 'Bookmarks',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Bookmarked talks',
      }),
    ).toBeTruthy();
    expect(screen.getByText('Tracking talks across a conference')).toBeTruthy();

    await user.click(
      within(
        screen.getByRole('navigation', { name: 'Destinations' }),
      ).getByRole('button', { name: 'Annotated' }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Annotated talks',
        level: 2,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText('Designing a calm note-taking workflow'),
    ).toBeTruthy();

    await user.click(
      within(
        screen.getByRole('navigation', { name: 'Destinations' }),
      ).getByRole('button', { name: 'Search' }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Search talks',
        level: 2,
      }),
    ).toBeTruthy();

    await user.type(
      screen.getByRole('searchbox', {
        name: 'Search talks',
      }),
      'Grace',
    );

    expect(screen.getByText('Tracking talks across a conference')).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: 'Open search result for Tracking talks across a conference',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: libraryEvent.title,
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Open talk for Tracking talks across a conference',
      }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: 'Back to library',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Open an event',
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByText(libraryEvent.title, {
        selector: '.nav-rail-foot strong',
      }),
    ).toBeNull();
  });

  it('refreshes the recently opened list after returning from slides', async () => {
    const user = userEvent.setup();
    const libraryEvent = {
      id: 'conference-1',
      sourceUrl: 'https://indico.example.org/event/indico-1',
      title: 'IndicoInk Small Event 2026',
      dates: 'June 12, 2026',
      host: 'small.indico.example.org',
      lastOpened: 'Opened just now',
      annotationSummary: '0 annotated slides',
      cacheStatus: 'Cached for offline use',
    };
    const updatedLibraryEvent = {
      ...libraryEvent,
      annotationSummary: '1 annotated slide',
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
        bookmarked: false,
        materialSummary: 'PDF',
        materials: [
          {
            id: 'deck-1',
            title: 'Opening slides',
            sourceUrl: 'https://indico.example.org/materials/deck-1.pdf',
            mimeType: 'application/pdf',
            selected: true,
            pageCount: 10,
          },
        ],
        annotatedSlideCount: 1,
      },
    ];

    window.indicoInk.listLibraryEvents = vi
      .fn()
      .mockResolvedValueOnce([libraryEvent])
      .mockResolvedValue([updatedLibraryEvent]);
    window.indicoInk.listAgendaTalks = vi.fn().mockResolvedValue(agendaTalks);

    render(<App />);

    await screen.findByRole('button', {
      name: `Open ${libraryEvent.title}`,
    });

    await user.click(
      screen.getByRole('button', {
        name: `Open ${libraryEvent.title}`,
      }),
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Open talk for Designing a calm note-taking workflow',
      }),
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Back to agenda',
      }),
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Back to library',
      }),
    );

    expect(await screen.findByText('1 annotated slide')).toBeTruthy();
  });

  it('refreshes the recently opened list when using the Library nav button', async () => {
    const user = userEvent.setup();
    const libraryEvent = {
      id: 'conference-2',
      sourceUrl: 'https://indico.example.org/event/indico-2',
      title: 'IndicoInk Library Route Event',
      dates: 'June 13, 2026',
      host: 'small.indico.example.org',
      lastOpened: 'Opened just now',
      annotationSummary: '0 annotated slides',
      cacheStatus: 'Cached for offline use',
    };
    const updatedLibraryEvent = {
      ...libraryEvent,
      annotationSummary: '2 annotated slides',
    };
    const agendaTalks = [
      {
        id: 'talk-2',
        conferenceId: libraryEvent.id,
        contributionId: 'contribution-2',
        sortStartsAt: Date.UTC(2026, 5, 13, 9, 0, 0, 0),
        dayLabel: 'Saturday, June 13, 2026',
        title: 'Navigating back to the library',
        speaker: 'Grace Hopper',
        sessionTitle: 'Routing session',
        timeRangeLabel: '09:00 - 09:45',
        room: 'Auditorium B',
        bookmarked: false,
        materialSummary: 'PDF',
        materials: [
          {
            id: 'deck-2',
            title: 'Routing slides',
            sourceUrl: 'https://indico.example.org/materials/deck-2.pdf',
            mimeType: 'application/pdf',
            selected: true,
            pageCount: 8,
          },
        ],
        annotatedSlideCount: 2,
      },
    ];

    window.indicoInk.listLibraryEvents = vi
      .fn()
      .mockResolvedValueOnce([libraryEvent])
      .mockResolvedValue([updatedLibraryEvent]);
    window.indicoInk.listAgendaTalks = vi.fn().mockResolvedValue(agendaTalks);

    render(<App />);

    await screen.findByRole('button', {
      name: `Open ${libraryEvent.title}`,
    });

    await user.click(
      screen.getByRole('button', {
        name: `Open ${libraryEvent.title}`,
      }),
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Open talk for Navigating back to the library',
      }),
    );

    await user.click(
      within(
        screen.getByRole('navigation', { name: 'Destinations' }),
      ).getByRole('button', {
        name: 'Library',
      }),
    );

    expect(await screen.findByText('2 annotated slides')).toBeTruthy();
  });

  it('keeps non-PDF materials in the materials dialog and opens the selected PDF deck', async () => {
    const user = userEvent.setup();
    const libraryEvent = {
      id: 'conference-chooser',
      sourceUrl: 'https://indico.example.org/event/chooser-2026',
      title: 'Chooser Event 2026',
      dates: 'June 12, 2026',
      host: 'chooser.indico.example.org',
      lastOpened: 'Opened just now',
      annotationSummary: '1 annotated slide',
      cacheStatus: 'Cached for offline use',
    };
    const agendaTalks = [
      {
        id: 'talk-chooser',
        conferenceId: libraryEvent.id,
        contributionId: 'contribution-chooser',
        contributionUrl:
          'https://indico.example.org/event/chooser-2026/contributions/contribution-chooser/',
        sortStartsAt: Date.UTC(2026, 5, 12, 9, 0, 0, 0),
        dayLabel: 'Friday, June 12, 2026',
        title: 'Opening the right deck',
        speaker: 'Judy Clapp',
        sessionTitle: 'Tooling session',
        timeRangeLabel: '09:00 - 09:30',
        room: 'Auditorium B',
        bookmarked: false,
        materialSummary: '2 PDFs',
        materials: [
          {
            id: 'deck-main',
            title: 'Main deck',
            sourceUrl: 'https://indico.example.org/materials/main.pdf',
            mimeType: 'application/pdf',
            selected: true,
            pageCount: 10,
          },
          {
            id: 'deck-alt',
            title: 'Alternate deck',
            sourceUrl: 'https://indico.example.org/materials/alt.pdf',
            mimeType: 'application/pdf',
            selected: false,
            pageCount: 6,
          },
          {
            id: 'slides-notes',
            title: 'Speaker notes',
            sourceUrl: 'https://indico.example.org/materials/notes.txt',
            mimeType: 'text/plain',
            selected: false,
            pageCount: null,
          },
        ],
        annotatedSlideCount: 1,
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
        name: 'Materials for Opening the right deck',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Materials for Opening the right deck',
        level: 3,
      }),
    ).toBeTruthy();
    expect(screen.getByText('Main deck · 10 pages')).toBeTruthy();
    expect(screen.getByText('Alternate deck · 6 pages')).toBeTruthy();
    expect(screen.getByText('Speaker notes · text/plain')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Link',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    await user.click(
      screen.getByRole('button', {
        name: 'Link',
      }),
    );
    expect(window.indicoInk.openExternalUrl).toHaveBeenCalledWith(
      'https://indico.example.org/event/chooser-2026/contributions/contribution-chooser/',
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Copy contribution link for Opening the right deck',
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('Copied to clipboard')).toBeTruthy();
    });
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      'https://indico.example.org/event/chooser-2026/contributions/contribution-chooser/',
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Select Alternate deck for Opening the right deck',
      }),
    );

    expect(window.indicoInk.setSelectedDeck).toHaveBeenCalledWith(
      'talk-chooser',
      'deck-alt',
    );

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Open slides',
      }),
    );

    expect(
      await screen.findByRole('button', {
        name: 'Home',
      }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Link',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      screen.getByRole('button', {
        name: 'Alternate deck',
      }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', {
        name: 'Link',
      }),
    );
    expect(window.indicoInk.openExternalUrl).toHaveBeenLastCalledWith(
      'https://indico.example.org/materials/alt.pdf',
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Copy PDF link for Alternate deck',
      }),
    );
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      'https://indico.example.org/materials/alt.pdf',
    );
    expect(window.indicoInk.openTalkDeck).toHaveBeenCalledWith(
      libraryEvent.id,
      'talk-chooser',
      'deck-alt',
    );

    await waitFor(
      () => {
        expect(screen.queryByText('Copied to clipboard')).toBeNull();
      },
      { timeout: 4000 },
    );
  }, 10_000);

  it('keeps agenda filters selected when switching days', async () => {
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
        materials: [
          {
            id: 'deck-1',
            title: 'Opening slides',
            sourceUrl: 'https://indico.example.org/materials/deck-1.pdf',
            mimeType: 'application/pdf',
            selected: true,
            pageCount: 10,
          },
        ],
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
        materials: [
          {
            id: 'deck-2a',
            title: 'Main deck',
            sourceUrl: 'https://indico.example.org/materials/deck-2a.pdf',
            mimeType: 'application/pdf',
            selected: true,
            pageCount: 8,
          },
          {
            id: 'deck-2b',
            title: 'Supplementary deck',
            sourceUrl: 'https://indico.example.org/materials/deck-2b.pdf',
            mimeType: 'application/pdf',
            selected: false,
            pageCount: 3,
          },
        ],
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
        materials: [],
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

    expect(
      screen.getByRole('button', {
        name: 'Fri Jun 12',
      }),
    ).toBeTruthy();

    const pageSurface = document.querySelector<HTMLElement>('.page-surface');
    if (!pageSurface) {
      throw new Error('Expected the page surface to be present.');
    }
    const originalGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRectMock(
        this: HTMLElement,
      ) {
        if (this.classList.contains('page-surface')) {
          return {
            top: 0,
            right: 900,
            bottom: 700,
            left: 0,
            width: 900,
            height: 700,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          };
        }

        if (this.classList.contains('agenda-shell-main')) {
          return {
            top: 0,
            right: 900,
            bottom: 1200,
            left: 0,
            width: 900,
            height: 1200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          };
        }

        if (this.classList.contains('agenda-canvas-scroll')) {
          return {
            top: -pageSurface.scrollTop,
            right: 900,
            bottom: 1200 - pageSurface.scrollTop,
            left: 0,
            width: 900,
            height: 1200,
            x: 0,
            y: -pageSurface.scrollTop,
            toJSON: () => ({}),
          };
        }

        return originalGetBoundingClientRect.call(this);
      });
    Object.defineProperty(pageSurface, 'scrollTop', {
      value: 420,
      configurable: true,
      writable: true,
    });
    fireEvent.scroll(pageSurface);
    await user.click(
      screen.getByRole('button', {
        name: 'Next day',
      }),
    );

    expect(
      screen.getByRole('button', {
        name: 'Sat Jun 13',
      }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: 'All',
      }),
    );

    expect(
      screen.getByRole('button', {
        name: 'Sat Jun 13',
      }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: 'Bookmarked',
      }),
    );

    expect(
      screen.getByRole('button', {
        name: 'Sat Jun 13',
      }),
    ).toBeTruthy();

    Object.defineProperty(pageSurface, 'scrollTop', {
      value: 125,
      configurable: true,
      writable: true,
    });
    fireEvent.scroll(pageSurface);
    await user.click(
      screen.getByRole('button', {
        name: 'Previous day',
      }),
    );

    expect(
      screen.getByRole('button', {
        name: 'Fri Jun 12',
      }),
    ).toBeTruthy();

    expect(
      screen
        .getByRole('button', {
          name: 'Bookmarked',
        })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    getBoundingClientRectSpy.mockRestore();
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
