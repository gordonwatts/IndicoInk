import React from 'react';

import type { AppInfo } from './shared/appInfo';
import type { AgendaTalkSummary } from './shared/agenda';
import type { LibraryEventSummary } from './shared/library';
import {
  CommandBar,
  DetailsSurface,
  DialogSurface,
  Icon,
  IconButton,
  NavButton,
  PrimaryButton,
  Row,
  SegmentedControl,
  StatusLabel,
  ThemePreview,
} from './ui';

type Destination =
  | 'library'
  | 'agenda'
  | 'bookmarks'
  | 'annotated'
  | 'settings';

type EventSummary = LibraryEventSummary;

const destinations: Array<{
  id: Destination;
  label: string;
  shortLabel: string;
  icon: React.ComponentProps<typeof NavButton>['icon'];
}> = [
  { id: 'library', label: 'Library', shortLabel: 'Lib', icon: 'library' },
  { id: 'agenda', label: 'Agenda', shortLabel: 'Agenda', icon: 'agenda' },
  { id: 'bookmarks', label: 'Bookmarks', shortLabel: 'Book', icon: 'bookmark' },
  {
    id: 'annotated',
    label: 'Annotated',
    shortLabel: 'Anno',
    icon: 'annotated',
  },
  { id: 'settings', label: 'Settings', shortLabel: 'Set', icon: 'settings' },
];

const defaultEvent: EventSummary = {
  id: 'conference-indicoink-design-summit-2026',
  sourceUrl: 'https://indico.example.org/event/indicoink-design-summit',
  title: 'IndicoInk Design Summit 2026',
  dates: 'June 12-14, 2026',
  host: 'indico.example.org',
  lastOpened: 'Opened 8 minutes ago',
  annotationSummary: '12 annotated slides',
  cacheStatus: 'Cached for offline use',
};

const filterOptions = [
  { label: 'All', value: 'all' as const },
  { label: 'Bookmarked', value: 'bookmarked' as const },
  { label: 'Annotated', value: 'annotated' as const },
  { label: 'Slides available', value: 'slides' as const },
];

type GalleryFilter = (typeof filterOptions)[number]['value'];

const validateEventUrl = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Paste an Indico event URL.';
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'Enter a valid URL that starts with https://.';
  }

  if (url.protocol !== 'https:') {
    return 'Use an https:// Indico event URL.';
  }

  if (!/\/event\/[^/?#]+/.test(url.pathname)) {
    return 'Use an Indico event URL that points to an event.';
  }

  return null;
};

function EventSummaryRow({
  event,
  selected,
  onOpen,
  onDelete,
}: {
  event: EventSummary;
  selected: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <Row
      variant="list"
      selected={selected}
      onClick={onOpen}
      ariaLabel={`Open ${event.title}`}
      title={event.title}
      meta={
        <>
          {event.dates} - {event.host}
        </>
      }
      detail={
        <div className="row-pills">
          <StatusLabel label={event.lastOpened} icon="info" />
          <StatusLabel
            label={event.annotationSummary}
            tone="success"
            icon="annotated"
          />
          <StatusLabel label={event.cacheStatus} tone="neutral" icon="check" />
        </div>
      }
      action={
        <div
          className="event-row-actions"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <IconButton
            label={`Delete ${event.title}`}
            icon="trash"
            onClick={onDelete}
          />
        </div>
      }
    />
  );
}

function ComponentGallery() {
  const [galleryFilter, setGalleryFilter] =
    React.useState<GalleryFilter>('all');

  return (
    <div className="gallery-grid">
      <ThemePreview theme="light">
        <DetailsSurface
          title="Light theme preview"
          subtitle="Reusable primitives rendered in a calm, bright surface."
        >
          <div className="gallery-stack">
            <CommandBar
              kicker="Preview"
              title="Command bar"
              status={
                <StatusLabel
                  label="Light theme active"
                  tone="success"
                  icon="check"
                />
              }
              leading={<IconButton label="Back" icon="back" />}
              actions={
                <>
                  <IconButton label="Search" icon="search" />
                  <IconButton label="Refresh" icon="refresh" />
                  <PrimaryButton icon="export">Export notes</PrimaryButton>
                </>
              }
            />
            <SegmentedControl
              options={filterOptions}
              value={galleryFilter}
              onChange={setGalleryFilter}
            />
            <Row
              title="Talk row"
              meta="Start time - title - speaker"
              detail={
                <StatusLabel
                  label="3 annotated slides"
                  tone="warning"
                  icon="annotated"
                />
              }
              action={<PrimaryButton>Open slides</PrimaryButton>}
            />
            <DialogSurface
              title="Delete event"
              body="This dialog pattern is reserved for destructive actions and other important decisions."
              primaryLabel="Delete event"
              secondaryLabel="Cancel"
            />
          </div>
        </DetailsSurface>
      </ThemePreview>

      <ThemePreview theme="dark">
        <DetailsSurface
          title="Dark theme preview"
          subtitle="The same primitives under the system dark palette."
        >
          <div className="gallery-stack">
            <CommandBar
              kicker="Preview"
              title="Command bar"
              status={
                <StatusLabel
                  label="Dark theme active"
                  tone="success"
                  icon="check"
                />
              }
              leading={<IconButton label="Back" icon="back" />}
              actions={
                <>
                  <IconButton label="Search" icon="search" />
                  <IconButton label="Refresh" icon="refresh" />
                  <PrimaryButton icon="export">Export notes</PrimaryButton>
                </>
              }
            />
            <SegmentedControl
              options={filterOptions}
              value={galleryFilter}
              onChange={setGalleryFilter}
            />
            <Row
              title="Details surface"
              meta="Supports metadata and decision-making content"
              detail={
                <StatusLabel
                  label="Cached for offline use"
                  tone="neutral"
                  icon="info"
                />
              }
              action={<PrimaryButton>Open event</PrimaryButton>}
            />
            <DialogSurface
              title="Import API key"
              body="The dialog layout keeps credentials focused and separate from ordinary navigation."
              primaryLabel="Save key"
              secondaryLabel="Cancel"
            />
          </div>
        </DetailsSurface>
      </ThemePreview>
    </div>
  );
}

export function App() {
  const [destination, setDestination] = React.useState<Destination>('library');
  const [eventUrl, setEventUrl] = React.useState('');
  const [eventUrlTouched, setEventUrlTouched] = React.useState(false);
  const [openEventFeedback, setOpenEventFeedback] = React.useState<{
    tone: 'neutral' | 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const [isOpeningEvent, setIsOpeningEvent] = React.useState(false);
  const [apiKeyDialogOrigin, setApiKeyDialogOrigin] = React.useState<
    string | null
  >(null);
  const [apiKeyValue, setApiKeyValue] = React.useState('');
  const [apiKeyError, setApiKeyError] = React.useState<string | null>(null);
  const [isSavingApiKey, setIsSavingApiKey] = React.useState(false);
  const [info, setInfo] = React.useState<AppInfo | null>(null);
  const [libraryEvents, setLibraryEvents] = React.useState<EventSummary[]>([]);
  const [selectedEventId, setSelectedEventId] = React.useState<string | null>(
    null,
  );
  const [agendaTalks, setAgendaTalks] = React.useState<AgendaTalkSummary[]>([]);
  const [agendaTalksLoading, setAgendaTalksLoading] = React.useState(false);
  const [agendaTalksError, setAgendaTalksError] = React.useState<string | null>(
    null,
  );
  const [agendaDayLabel, setAgendaDayLabel] = React.useState<string | null>(
    null,
  );
  const [agendaFilter, setAgendaFilter] =
    React.useState<GalleryFilter>('all');
  const [deleteTarget, setDeleteTarget] = React.useState<EventSummary | null>(
    null,
  );

  React.useEffect(() => {
    void window.indicoInk.getAppInfo().then(setInfo);
  }, []);

  const refreshLibraryEvents = React.useCallback(async () => {
    const events = await window.indicoInk.listLibraryEvents();
    setLibraryEvents(events);
  }, []);

  React.useEffect(() => {
    void refreshLibraryEvents();
  }, [refreshLibraryEvents]);

  const eventFocused =
    destination === 'agenda' ||
    destination === 'bookmarks' ||
    destination === 'annotated';
  const activeEvent =
    libraryEvents.find((event) => event.id === selectedEventId) ?? defaultEvent;
  const selectedAgendaEvent = selectedEventId
    ? libraryEvents.find((event) => event.id === selectedEventId) ?? null
    : null;
  const agendaDayLabels = Array.from(
    new Set(agendaTalks.map((talk) => talk.dayLabel)),
  );
  const selectedAgendaDay = agendaDayLabels.includes(agendaDayLabel ?? '')
    ? agendaDayLabel
    : agendaDayLabels[0] ?? null;
  const visibleAgendaTalks = agendaTalks.filter((talk) => {
    const matchesDay =
      selectedAgendaDay === null || talk.dayLabel === selectedAgendaDay;
    const matchesFilter =
      agendaFilter === 'all'
        ? true
        : agendaFilter === 'bookmarked'
          ? talk.bookmarked
          : agendaFilter === 'annotated'
            ? talk.annotatedSlideCount > 0
            : talk.materialSummary !== 'No slides';

    return matchesDay && matchesFilter;
  });
  const selectedAgendaDayIndex = selectedAgendaDay
    ? agendaDayLabels.indexOf(selectedAgendaDay)
    : -1;
  const canMoveToPreviousDay = selectedAgendaDayIndex > 0;
  const canMoveToNextDay =
    selectedAgendaDayIndex >= 0 &&
    selectedAgendaDayIndex < agendaDayLabels.length - 1;
  const eventUrlError = eventUrlTouched ? validateEventUrl(eventUrl) : null;
  const handleOpenEvent = async () => {
    setEventUrlTouched(true);
    const validationError = validateEventUrl(eventUrl);
    if (validationError) {
      setOpenEventFeedback({
        tone: 'error',
        message: validationError,
      });
      return;
    }

    setIsOpeningEvent(true);
    setOpenEventFeedback({
      tone: 'neutral',
      message: 'Opening event and saving the agenda locally...',
    });

    try {
      const openedEvent = await window.indicoInk.openLibraryEvent(eventUrl);
      if (openedEvent.kind === 'api-key-required') {
        setApiKeyDialogOrigin(openedEvent.origin);
        setApiKeyValue('');
        setApiKeyError(openedEvent.message);
        setOpenEventFeedback({
          tone: 'warning',
          message: openedEvent.message,
        });
        return;
      }

      await refreshLibraryEvents();
      setSelectedEventId(openedEvent.result.conferenceId);
      setDestination('agenda');
      setApiKeyDialogOrigin(null);
      setApiKeyValue('');
      setApiKeyError(null);
      setOpenEventFeedback({
        tone: 'success',
        message: `Opened ${openedEvent.result.title} with ${openedEvent.result.talkCount} talks.`,
      });
    } catch (error) {
      setOpenEventFeedback({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to open the event.',
      });
    } finally {
      setIsOpeningEvent(false);
    }
  };
  const handleSaveApiKey = async () => {
    if (!apiKeyDialogOrigin) {
      return;
    }

    const trimmedApiKey = apiKeyValue.trim();
    if (!trimmedApiKey) {
      setApiKeyError('Enter an API key.');
      return;
    }

    setIsSavingApiKey(true);
    setApiKeyError(null);

    try {
      await window.indicoInk.saveIndicoApiKey(
        apiKeyDialogOrigin,
        trimmedApiKey,
      );
      const reopenedEvent = await window.indicoInk.openLibraryEvent(
        eventUrl,
        trimmedApiKey,
      );
      if (reopenedEvent.kind === 'api-key-required') {
        setApiKeyError(reopenedEvent.message);
        setOpenEventFeedback({
          tone: 'warning',
          message: reopenedEvent.message,
        });
        return;
      }

      await refreshLibraryEvents();
      setSelectedEventId(reopenedEvent.result.conferenceId);
      setDestination('agenda');
      setApiKeyDialogOrigin(null);
      setApiKeyValue('');
      setOpenEventFeedback({
        tone: 'success',
        message: `Opened ${reopenedEvent.result.title} with ${reopenedEvent.result.talkCount} talks.`,
      });
    } catch (error) {
      setApiKeyError(
        error instanceof Error ? error.message : 'Failed to save the API key.',
      );
    } finally {
      setIsSavingApiKey(false);
    }
  };
  const openLibraryEvent = (event: EventSummary) => {
    setSelectedEventId(event.id);
    setDestination('agenda');
  };
  const requestDeleteLibraryEvent = (event: EventSummary) => {
    setDeleteTarget(event);
  };
  const confirmDeleteLibraryEvent = async () => {
    if (!deleteTarget) {
      return;
    }

    const deletingSelected = selectedEventId === deleteTarget.id;
    await window.indicoInk.deleteLibraryEvent(deleteTarget.id);
    setDeleteTarget(null);
    await refreshLibraryEvents();

    if (deletingSelected) {
      setSelectedEventId(null);
      setDestination('library');
    }
  };

  React.useEffect(() => {
    let cancelled = false;

    if (destination !== 'agenda' || !selectedEventId) {
      setAgendaTalks([]);
      setAgendaTalksLoading(false);
      setAgendaTalksError(null);
      setAgendaDayLabel(null);
      return () => {
        cancelled = true;
      };
    }

    setAgendaTalksLoading(true);
    setAgendaTalksError(null);

    void window.indicoInk
      .listAgendaTalks(selectedEventId)
      .then((talks) => {
        if (!cancelled) {
          setAgendaTalks(talks);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAgendaTalksError(
            error instanceof Error
              ? error.message
              : 'Failed to load the agenda list.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAgendaTalksLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [destination, selectedEventId]);

  React.useEffect(() => {
    if (!agendaTalks.length) {
      setAgendaDayLabel(null);
      return;
    }

    setAgendaDayLabel((current) => {
      if (current && agendaTalks.some((talk) => talk.dayLabel === current)) {
        return current;
      }

      return agendaTalks[0]?.dayLabel ?? null;
    });
  }, [agendaTalks]);

  return (
    <div className="app-frame">
      <aside className="nav-rail" aria-label="Primary navigation">
        <div className="nav-rail-brand" aria-label="IndicoInk">
          <div className="brand-mark">I</div>
          <div className="brand-copy">
            <span className="brand-title">IndicoInk</span>
            <span className="brand-subtitle">V1 shell</span>
          </div>
        </div>

        <nav className="nav-group" aria-label="Destinations">
          {destinations.map((item) => (
            <NavButton
              key={item.id}
              active={destination === item.id}
              label={item.label}
              shortLabel={item.shortLabel}
              icon={item.icon}
              onClick={() => setDestination(item.id)}
            />
          ))}
        </nav>

        <div className="nav-rail-foot">
          <span className="nav-foot-label">Current event</span>
          <strong>{activeEvent.title}</strong>
        </div>
      </aside>

      <section className="workspace">
        <CommandBar
          kicker={destination === 'library' ? 'Library' : activeEvent.title}
          title={
            destination === 'library'
              ? 'Open a conference event'
              : destination === 'agenda'
                ? 'Event agenda'
                : destination === 'bookmarks'
                  ? 'Bookmarks'
                  : destination === 'annotated'
                    ? 'Annotated talks'
                    : 'Settings'
          }
          status={
            eventFocused ? (
              <StatusLabel
                label="Current event active"
                tone="success"
                icon="event"
              />
            ) : (
              <StatusLabel label="Library view" icon="library" />
            )
          }
          leading={
            destination === 'library' ? undefined : (
              <IconButton
                label="Back"
                icon="back"
                onClick={() => setDestination('library')}
              />
            )
          }
          actions={
            <>
              <IconButton label="Search" icon="search" />
              <IconButton label="Refresh" icon="refresh" />
              <PrimaryButton icon="export">Export notes</PrimaryButton>
              <div className="runtime-pill" aria-label="Runtime information">
                <span className="runtime-pill-label">Runtime</span>
                <span className="runtime-pill-value">
                  {info
                    ? `${info.appName} - Electron ${info.electronVersion}`
                    : 'Loading...'}
                </span>
              </div>
            </>
          }
        />

        <main className="page-surface" aria-live="polite">
          {destination === 'library' && (
            <section className="page-stack">
              <div className="hero-panel">
                <div className="hero-copy">
                  <p className="eyebrow">Conference library</p>
                  <h2>
                    Open an Indico event or return to one already on disk.
                  </h2>
                  <p className="lede">
                    Paste a conference URL, keep invalid input visible, and open
                    the event from one prominent touch target.
                  </p>
                </div>
                <div className="hero-actions">
                  <label className="field">
                    <span>Event URL</span>
                    <input
                      value={eventUrl}
                      onChange={(event) => {
                        setEventUrl(event.target.value);
                        setEventUrlTouched(true);
                      }}
                      onBlur={() => setEventUrlTouched(true)}
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      placeholder="https://indico.example.org/event/..."
                      aria-invalid={eventUrlError ? 'true' : undefined}
                      aria-describedby={
                        eventUrlError
                          ? 'event-url-help event-url-error'
                          : 'event-url-help'
                      }
                    />
                  </label>
                  <div className="field-help" id="event-url-help">
                    Use a full Indico event URL such as
                    <code>https://indico.example.org/event/...</code>
                  </div>
                  {eventUrlError ? (
                    <div className="field-error" id="event-url-error">
                      <StatusLabel
                        label={eventUrlError}
                        tone="error"
                        icon="info"
                      />
                    </div>
                  ) : null}
                  {openEventFeedback ? (
                    <div
                      className="field-help"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      <StatusLabel
                        label={openEventFeedback.message}
                        tone={openEventFeedback.tone}
                        icon={
                          openEventFeedback.tone === 'error'
                            ? 'info'
                            : openEventFeedback.tone === 'success'
                              ? 'check'
                              : 'event'
                        }
                      />
                    </div>
                  ) : null}
                  <PrimaryButton
                    icon="event"
                    className="large"
                    disabled={isOpeningEvent}
                    onClick={handleOpenEvent}
                  >
                    {isOpeningEvent ? 'Opening…' : 'Open event'}
                  </PrimaryButton>
                </div>
              </div>

              <section className="surface-panel" aria-label="Recent events">
                <div className="surface-panel-header">
                  <h3>Recently opened</h3>
                  <p>Most recent event first.</p>
                </div>
                {libraryEvents.length ? (
                  <div className="event-list">
                    {libraryEvents.map((event) => (
                      <EventSummaryRow
                        key={event.id}
                        event={event}
                        selected={event.id === selectedEventId}
                        onOpen={() => openLibraryEvent(event)}
                        onDelete={() => requestDeleteLibraryEvent(event)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Icon name="library" />
                    <strong>No saved events yet</strong>
                    <span>
                      Open a conference event to start building the local
                      library.
                    </span>
                  </div>
                )}
              </section>
            </section>
          )}

          {destination === 'agenda' && (
            <section className="page-stack">
              <div className="overview-grid">
                <DetailsSurface
                  title={activeEvent.title}
                  subtitle={activeEvent.dates}
                >
                  <div className="event-details">
                    <StatusLabel label={activeEvent.host} icon="info" />
                    <StatusLabel
                      label={activeEvent.cacheStatus}
                      tone="success"
                      icon="check"
                    />
                    <StatusLabel
                      label={activeEvent.annotationSummary}
                      tone="warning"
                      icon="annotated"
                    />
                  </div>
                </DetailsSurface>
                <DetailsSurface
                  title="Agenda list milestone"
                  subtitle="Temporary single-column list built from stored agenda data. The final V1 agenda is the two-dimensional day canvas."
                >
                  {selectedAgendaEvent ? (
                    <div className="agenda-milestone">
                      <div className="agenda-milestone-note">
                        <StatusLabel
                          label={`Loaded ${agendaTalks.length} talks from ${selectedAgendaEvent.title}`}
                          tone="success"
                          icon="agenda"
                        />
                      </div>
                      {agendaTalksLoading ? (
                        <div className="empty-state agenda-empty-state">
                          <Icon name="agenda" />
                          <strong>Loading agenda talks</strong>
                          <span>
                            Stored talks are being read from the local event
                            cache.
                          </span>
                        </div>
                      ) : agendaTalksError ? (
                        <div className="empty-state agenda-empty-state">
                          <Icon name="info" />
                          <strong>Agenda unavailable</strong>
                          <span>{agendaTalksError}</span>
                        </div>
                      ) : agendaTalks.length ? (
                        <>
                          <div className="agenda-controls">
                            <div className="agenda-day-strip">
                              <IconButton
                                label="Previous day"
                                icon="back"
                                disabled={!canMoveToPreviousDay}
                                onClick={() => {
                                  if (canMoveToPreviousDay) {
                                    setAgendaDayLabel(
                                      agendaDayLabels[
                                        selectedAgendaDayIndex - 1
                                      ] ?? null,
                                    );
                                  }
                                }}
                              />
                              <SegmentedControl
                                options={agendaDayLabels.map((label) => ({
                                  label,
                                  value: label,
                                }))}
                                value={
                                  selectedAgendaDay ?? agendaDayLabels[0] ?? ''
                                }
                                onChange={setAgendaDayLabel}
                              />
                              <IconButton
                                label="Next day"
                                icon="chevron"
                                disabled={!canMoveToNextDay}
                                onClick={() => {
                                  if (canMoveToNextDay) {
                                    setAgendaDayLabel(
                                      agendaDayLabels[
                                        selectedAgendaDayIndex + 1
                                      ] ?? null,
                                    );
                                  }
                                }}
                              />
                            </div>
                            <SegmentedControl
                              options={filterOptions}
                              value={agendaFilter}
                              onChange={setAgendaFilter}
                            />
                          </div>

                          <div className="agenda-list-meta">
                            <StatusLabel
                              label={`${visibleAgendaTalks.length} talk${visibleAgendaTalks.length === 1 ? '' : 's'} shown`}
                              icon="agenda"
                            />
                            <StatusLabel
                              label={selectedAgendaDay ?? 'All days'}
                              tone="neutral"
                              icon="event"
                            />
                            <StatusLabel
                              label={
                                agendaFilter === 'all'
                                  ? 'All talks'
                                  : agendaFilter === 'bookmarked'
                                    ? 'Bookmarked'
                                    : agendaFilter === 'annotated'
                                      ? 'Annotated'
                                      : 'Slides available'
                              }
                              tone="neutral"
                              icon="check"
                            />
                          </div>

                          {visibleAgendaTalks.length ? (
                            <div className="agenda-list">
                              {visibleAgendaTalks.map((talk) => (
                                <Row
                                  key={talk.id}
                                  variant="list"
                                  title={talk.title}
                                  meta={
                                    <>
                                      {talk.timeRangeLabel} -{' '}
                                      {talk.sessionTitle} - {talk.room}
                                    </>
                                  }
                                  detail={
                                    <div className="row-pills">
                                      <StatusLabel
                                        label={talk.speaker}
                                        icon="info"
                                      />
                                      <StatusLabel
                                        label={talk.materialSummary}
                                        tone="neutral"
                                        icon="open"
                                      />
                                      <StatusLabel
                                        label={`${talk.annotatedSlideCount} annotated slide${talk.annotatedSlideCount === 1 ? '' : 's'}`}
                                        tone="warning"
                                        icon="annotated"
                                      />
                                    </div>
                                  }
                                  action={
                                    talk.bookmarked ? (
                                      <StatusLabel
                                        label="Bookmarked"
                                        tone="success"
                                        icon="bookmark"
                                      />
                                    ) : undefined
                                  }
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="empty-state agenda-empty-state">
                              <Icon name="agenda" />
                              <strong>No talks match this view</strong>
                              <span>
                                Try a different day or filter to keep browsing
                                the stored agenda data.
                              </span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="empty-state agenda-empty-state">
                          <Icon name="agenda" />
                          <strong>No stored talks yet</strong>
                          <span>
                            Open a conference event to populate the temporary
                            agenda list.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="empty-state agenda-empty-state">
                      <Icon name="agenda" />
                      <strong>No active event selected</strong>
                      <span>
                        Open a stored conference event from Library to browse
                        its agenda.
                      </span>
                    </div>
                  )}
                </DetailsSurface>
              </div>
            </section>
          )}

          {destination === 'bookmarks' && (
            <section className="page-stack">
              <DetailsSurface
                title="Bookmarks across the active event"
                subtitle="A future event-wide view will show saved talks without leaving the current conference context."
              >
                <div className="empty-state">
                  <Icon name="bookmark" />
                  <strong>No bookmarked talks yet</strong>
                  <span>
                    Saved talks will appear here once the agenda is wired up.
                  </span>
                </div>
              </DetailsSurface>
            </section>
          )}

          {destination === 'annotated' && (
            <section className="page-stack">
              <DetailsSurface
                title="Annotated talks in the current event"
                subtitle="Slide annotations stay attached to the active conference while the user moves between destinations."
              >
                <div className="empty-state">
                  <Icon name="annotated" />
                  <strong>{activeEvent.annotationSummary}</strong>
                  <span>
                    Annotated talks will be surfaced here once slide notes
                    exist.
                  </span>
                </div>
              </DetailsSurface>
            </section>
          )}

          {destination === 'settings' && (
            <section className="page-stack">
              <div className="overview-grid">
                <DetailsSurface
                  title="Application settings"
                  subtitle="Placeholder surface for app-wide preferences."
                >
                  <div className="settings-list">
                    <div className="settings-row">
                      <span>Theme</span>
                      <strong>System aware, later in the plan</strong>
                    </div>
                    <div className="settings-row">
                      <span>Data folder</span>
                      <strong>Local app data, later in the plan</strong>
                    </div>
                    <div className="settings-row">
                      <span>Runtime</span>
                      <strong>
                        {info
                          ? `${info.appName} - ${info.electronVersion}`
                          : 'Loading...'}
                      </strong>
                    </div>
                  </div>
                </DetailsSurface>
                <DetailsSurface
                  title="Current event context"
                  subtitle="Event ownership persists while moving between agenda-related views."
                >
                  <div className="event-context">
                    <strong>{activeEvent.title}</strong>
                    <span>{activeEvent.dates}</span>
                    <span>{activeEvent.host}</span>
                  </div>
                </DetailsSurface>
              </div>

              <ComponentGallery />
            </section>
          )}

          {deleteTarget ? (
            <div className="dialog-backdrop" role="presentation">
              <DialogSurface
                title="Delete event"
                body={
                  <>
                    <p>
                      Cached slides and annotations for{' '}
                      <strong>{deleteTarget.title}</strong> will be deleted from
                      this computer.
                    </p>
                    <p>{deleteTarget.sourceUrl}</p>
                  </>
                }
                primaryLabel="Delete event"
                secondaryLabel="Cancel"
                onPrimary={() => void confirmDeleteLibraryEvent()}
                onSecondary={() => setDeleteTarget(null)}
              />
            </div>
          ) : null}

          {apiKeyDialogOrigin ? (
            <div className="dialog-backdrop" role="presentation">
              <DialogSurface
                title="Private event"
                body={
                  <div className="dialog-copy">
                    <p>
                      This event at <strong>{apiKeyDialogOrigin}</strong> needs
                      an API key before it can be opened.
                    </p>
                    <label className="field">
                      <span>API key</span>
                      <input
                        autoFocus
                        value={apiKeyValue}
                        onChange={(event) => {
                          setApiKeyValue(event.target.value);
                          setApiKeyError(null);
                        }}
                        type="password"
                        autoComplete="off"
                        placeholder="Paste API key"
                        aria-label="API key"
                        aria-invalid={apiKeyError ? 'true' : undefined}
                      />
                    </label>
                    {apiKeyError ? (
                      <div className="field-error">
                        <StatusLabel
                          label={apiKeyError}
                          tone="error"
                          icon="info"
                        />
                      </div>
                    ) : (
                      <div className="field-help">
                        Saved locally using Electron safeStorage.
                      </div>
                    )}
                  </div>
                }
                primaryLabel={isSavingApiKey ? 'Saving...' : 'Save key'}
                secondaryLabel="Cancel"
                onPrimary={() => void handleSaveApiKey()}
                onSecondary={() => {
                  setApiKeyDialogOrigin(null);
                  setApiKeyValue('');
                  setApiKeyError(null);
                }}
              />
            </div>
          ) : null}
        </main>
      </section>
    </div>
  );
}
