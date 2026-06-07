import React from 'react';

import type { AppInfo } from './shared/appInfo';
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

type EventSummary = {
  title: string;
  dates: string;
  host: string;
  lastOpened: string;
  annotationSummary: string;
  cacheStatus: string;
};

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

const currentEvent: EventSummary = {
  title: 'IndicoInk Design Summit 2026',
  dates: 'June 12-14, 2026',
  host: 'indico.example.org',
  lastOpened: 'Opened 8 minutes ago',
  annotationSummary: '12 annotated slides',
  cacheStatus: 'Cached for offline use',
};

const recentEvents: EventSummary[] = [];

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

function EventSummaryRow({ event }: { event: EventSummary }) {
  return (
    <Row
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
      action={<PrimaryButton title={`Open ${event.title}`}>Open</PrimaryButton>}
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
  const [info, setInfo] = React.useState<AppInfo | null>(null);

  React.useEffect(() => {
    void window.indicoInk.getAppInfo().then(setInfo);
  }, []);

  const eventFocused =
    destination === 'agenda' ||
    destination === 'bookmarks' ||
    destination === 'annotated';
  const eventUrlError = eventUrlTouched ? validateEventUrl(eventUrl) : null;
  const handleOpenEvent = () => {
    setEventUrlTouched(true);

    if (validateEventUrl(eventUrl)) {
      return;
    }

    setDestination('agenda');
  };

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
          <strong>{currentEvent.title}</strong>
        </div>
      </aside>

      <section className="workspace">
        <CommandBar
          kicker={destination === 'library' ? 'Library' : currentEvent.title}
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
                    Paste a conference URL, keep invalid input visible, and
                    open the event from one prominent touch target.
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
                  <PrimaryButton
                    icon="event"
                    className="large"
                    onClick={handleOpenEvent}
                  >
                    Open event
                  </PrimaryButton>
                </div>
              </div>

              <section className="surface-panel" aria-label="Recent events">
                <div className="surface-panel-header">
                  <h3>Recently opened</h3>
                  <p>Most recent event first.</p>
                </div>
                {recentEvents.length ? (
                  <div className="event-list">
                    {recentEvents.map((event) => (
                      <EventSummaryRow key={event.title} event={event} />
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
                  title={currentEvent.title}
                  subtitle={currentEvent.dates}
                >
                  <div className="event-details">
                    <StatusLabel label={currentEvent.host} icon="info" />
                    <StatusLabel
                      label={currentEvent.cacheStatus}
                      tone="success"
                      icon="check"
                    />
                    <StatusLabel
                      label={currentEvent.annotationSummary}
                      tone="warning"
                      icon="annotated"
                    />
                  </div>
                </DetailsSurface>
                <DetailsSurface
                  title="Agenda frame"
                  subtitle="Placeholder canvas structure for V1."
                >
                  <div className="placeholder-canvas">
                    <div className="canvas-chip">Day strip</div>
                    <div className="canvas-chip">Filters</div>
                    <div className="canvas-block">
                      <strong>Session block</strong>
                      <span>
                        Time, room, talk rows, and shared canvas layout land
                        here.
                      </span>
                    </div>
                  </div>
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
                  <strong>{currentEvent.annotationSummary}</strong>
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
                    <strong>{currentEvent.title}</strong>
                    <span>{currentEvent.dates}</span>
                    <span>{currentEvent.host}</span>
                  </div>
                </DetailsSurface>
              </div>

              <ComponentGallery />
            </section>
          )}
        </main>
      </section>
    </div>
  );
}
