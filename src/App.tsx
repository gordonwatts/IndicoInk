import React from 'react';

import type { AppInfo } from './shared/appInfo';

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
  icon: IconName;
}> = [
  { id: 'library', label: 'Library', shortLabel: 'Lib', icon: 'library' },
  { id: 'agenda', label: 'Agenda', shortLabel: 'Agenda', icon: 'agenda' },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    shortLabel: 'Book',
    icon: 'bookmark',
  },
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

const recentEvents: EventSummary[] = [
  currentEvent,
  {
    title: 'Windows Dev Day 2026',
    dates: 'May 3-4, 2026',
    host: 'events.example.net',
    lastOpened: 'Opened yesterday',
    annotationSummary: '4 annotated slides',
    cacheStatus: 'Online only',
  },
];

type IconName =
  | 'library'
  | 'agenda'
  | 'bookmark'
  | 'annotated'
  | 'settings'
  | 'back'
  | 'search'
  | 'refresh'
  | 'export'
  | 'event';

const iconPaths: Record<IconName, string> = {
  library: 'M6 5.5h12A2.5 2.5 0 0 1 20.5 8v8A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16V8A2.5 2.5 0 0 1 6 5.5Zm0 2A.5.5 0 0 0 5.5 8v8a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V8a.5.5 0 0 0-.5-.5H6Zm2 2h8v2H8v-2Zm0 4h6v2H8v-2Z',
  agenda:
    'M6 5.5h12A2.5 2.5 0 0 1 20.5 8v8A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16V8A2.5 2.5 0 0 1 6 5.5Zm0 2A.5.5 0 0 0 5.5 8v8a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V8a.5.5 0 0 0-.5-.5H6Zm2 1.75h8v1.5H8v-1.5Zm0 3.25h8v1.5H8v-1.5Zm0 3.25h5v1.5H8v-1.5Z',
  bookmark:
    'M7 4.5h10A1.5 1.5 0 0 1 18.5 6v12l-6.5-3.5L5.5 18V6A1.5 1.5 0 0 1 7 4.5Zm0 2v8.15l4.5-2.43 4.5 2.43V6H7Z',
  annotated:
    'M7 4.5h10A1.5 1.5 0 0 1 18.5 6v6.1a4.6 4.6 0 0 0-2-1.23V6H7v12l2.3-1.24a4.6 4.6 0 0 0 1.02 1.71L7 21V6A1.5 1.5 0 0 1 8.5 4.5Zm7.8 9.2 1.15 1.15 3.15-3.15 1.05 1.05-4.2 4.2-2.2-2.2 1.05-1.05Z',
  settings:
    'M12 7.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Zm0 1.8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm6.15 1.2.9 1.56-1.52 1.05c.03.18.05.36.05.55s-.02.37-.05.55l1.52 1.05-.9 1.56-1.8-.62a5.5 5.5 0 0 1-.95.55l-.33 1.88h-1.8l-.33-1.88a5.5 5.5 0 0 1-.95-.55l-1.8.62-.9-1.56 1.52-1.05a4.1 4.1 0 0 1 0-1.1l-1.52-1.05.9-1.56 1.8.62c.3-.22.62-.4.95-.55l.33-1.88h1.8l.33 1.88c.33.15.65.33.95.55l1.8-.62Z',
  back:
    'M15.3 4.9 9.2 11l6.1 6.1-1.4 1.4-7.5-7.5 7.5-7.5 1.4 1.4Z',
  search:
    'M10.5 4.75a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5Zm0 2a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Zm5.18 7.76 3.82 3.82-1.41 1.41-3.82-3.82 1.41-1.41Z',
  refresh:
    'M17.35 8.65A6.5 6.5 0 1 0 18.5 12h-2a4.5 4.5 0 1 1-.83-2.6L14 11h5V6l-1.65 1.65Z',
  export:
    'M12 4.5 16 8.5h-2.75V14h-2.5V8.5H8L12 4.5Zm-6 11h12v2H6v-2Z',
  event:
    'M6 5.5h12A2.5 2.5 0 0 1 20.5 8v8A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16V8A2.5 2.5 0 0 1 6 5.5Zm0 2A.5.5 0 0 0 5.5 8v8a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V8a.5.5 0 0 0-.5-.5H6Zm2 2h8v2H8v-2Zm0 4h5v2H8v-2Z',
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d={iconPaths[name]} />
    </svg>
  );
}

function ShellButton({
  active,
  label,
  shortLabel,
  icon,
  onClick,
  title,
}: {
  active?: boolean;
  label: string;
  shortLabel?: string;
  icon: IconName;
  onClick?: () => void;
  title: string;
}) {
  return (
    <button
      className={`shell-button${active ? ' is-active' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={title}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="shell-button-label">
        <span className="shell-button-full">{label}</span>
        <span className="shell-button-short">{shortLabel ?? label}</span>
      </span>
    </button>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
    </div>
  );
}

function EventSummaryRow({ event }: { event: EventSummary }) {
  return (
    <article className="event-row">
      <div className="event-row-main">
        <div className="event-row-title">{event.title}</div>
        <div className="event-row-meta">
          {event.dates} · {event.host}
        </div>
      </div>
      <div className="event-row-side">
        <span>{event.lastOpened}</span>
        <span>{event.annotationSummary}</span>
        <span>{event.cacheStatus}</span>
      </div>
      <button
        className="event-row-action"
        type="button"
        title={`Open ${event.title}`}
      >
        Open
      </button>
    </article>
  );
}

export function App() {
  const [destination, setDestination] = React.useState<Destination>('library');
  const [eventUrl, setEventUrl] = React.useState(
    'https://indico.example.org/event/indicoink-design-summit',
  );
  const [info, setInfo] = React.useState<AppInfo | null>(null);

  React.useEffect(() => {
    void window.indicoInk.getAppInfo().then(setInfo);
  }, []);

  const eventFocused = destination === 'agenda' || destination === 'bookmarks' || destination === 'annotated';

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
            <ShellButton
              key={item.id}
              active={destination === item.id}
              label={item.label}
              shortLabel={item.shortLabel}
              icon={item.icon}
              title={item.label}
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
        <header className="command-bar">
          <div className="command-bar-leading">
            <button
              className="icon-button"
              type="button"
              title="Back"
              aria-label="Back"
              onClick={() => setDestination('library')}
            >
              <Icon name="back" />
            </button>
            <div className="command-title-group">
              <p className="command-kicker">
                {destination === 'library' ? 'Library' : currentEvent.title}
              </p>
              <h1 className="command-title">
                {destination === 'library'
                  ? 'Open a conference event'
                  : destination === 'agenda'
                    ? 'Event agenda'
                    : destination === 'bookmarks'
                      ? 'Bookmarks'
                      : destination === 'annotated'
                        ? 'Annotated talks'
                        : 'Settings'}
              </h1>
            </div>
            {eventFocused ? (
              <span className="status-chip status-chip-accent">
                <Icon name="event" />
                Current event active
              </span>
            ) : (
              <span className="status-chip">Library view</span>
            )}
          </div>

          <div className="command-bar-actions">
            <button className="icon-button" type="button" title="Search" aria-label="Search">
              <Icon name="search" />
            </button>
            <button className="icon-button" type="button" title="Refresh" aria-label="Refresh">
              <Icon name="refresh" />
            </button>
            <button className="primary-button" type="button" title="Export notes">
              <Icon name="export" />
              <span>Export notes</span>
            </button>
            <div className="runtime-pill" aria-label="Runtime information">
              <span className="runtime-pill-label">Runtime</span>
              <span className="runtime-pill-value">
                {info ? `${info.appName} · Electron ${info.electronVersion}` : 'Loading...'}
              </span>
            </div>
          </div>
        </header>

        <main className="page-surface" aria-live="polite">
          {destination === 'library' && (
            <section className="page-stack">
              <div className="hero-panel">
                <div className="hero-copy">
                  <p className="eyebrow">Conference library</p>
                  <h2>Open an Indico event or return to one already on disk.</h2>
                  <p className="lede">
                    The V1 library keeps the primary action upfront and the
                    recent event list calm and grouped, ready for touch or
                    keyboard input.
                  </p>
                </div>
                <div className="hero-actions">
                  <label className="field">
                    <span>Event URL</span>
                    <input
                      value={eventUrl}
                      onChange={(event) => setEventUrl(event.target.value)}
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      placeholder="https://indico.example.org/event/..."
                    />
                  </label>
                  <button
                    className="primary-button large"
                    type="button"
                    onClick={() => setDestination('agenda')}
                  >
                    <Icon name="event" />
                    <span>Open event</span>
                  </button>
                </div>
              </div>

              <section className="surface-panel" aria-label="Recent events">
                <div className="surface-panel-header">
                  <h3>Recently opened</h3>
                  <p>Most recent event first.</p>
                </div>
                <div className="event-list">
                  {recentEvents.map((event) => (
                    <EventSummaryRow key={event.title} event={event} />
                  ))}
                </div>
              </section>
            </section>
          )}

          {destination === 'agenda' && (
            <section className="page-stack">
              <div className="overview-grid">
                <section className="surface-panel">
                  <div className="surface-panel-header">
                    <h2>{currentEvent.title}</h2>
                    <p>{currentEvent.dates}</p>
                  </div>
                  <div className="event-details">
                    <StatCard label="Host" value={currentEvent.host} />
                    <StatCard label="Status" value={currentEvent.cacheStatus} />
                    <StatCard label="Notes" value={currentEvent.annotationSummary} />
                  </div>
                </section>
                <section className="surface-panel">
                  <div className="surface-panel-header">
                    <h3>Agenda frame</h3>
                    <p>Placeholder canvas structure for V1.</p>
                  </div>
                  <div className="placeholder-canvas">
                    <div className="canvas-chip">Day strip</div>
                    <div className="canvas-chip">Filters</div>
                    <div className="canvas-block">
                      <strong>Session block</strong>
                      <span>Time, room, talk rows, and shared canvas layout land here.</span>
                    </div>
                  </div>
                </section>
              </div>
            </section>
          )}

          {destination === 'bookmarks' && (
            <section className="page-stack">
              <section className="surface-panel">
                <div className="surface-panel-header">
                  <h2>Bookmarks across the active event</h2>
                  <p>
                    A future event-wide view will show saved talks without
                    leaving the current conference context.
                  </p>
                </div>
                <div className="empty-state">
                  <Icon name="bookmark" />
                  <strong>No bookmarked talks yet</strong>
                  <span>Saved talks will appear here once the agenda is wired up.</span>
                </div>
              </section>
            </section>
          )}

          {destination === 'annotated' && (
            <section className="page-stack">
              <section className="surface-panel">
                <div className="surface-panel-header">
                  <h2>Annotated talks in the current event</h2>
                  <p>
                    Slide annotations stay attached to the active conference
                    while the user moves between destinations.
                  </p>
                </div>
                <div className="empty-state">
                  <Icon name="annotated" />
                  <strong>{currentEvent.annotationSummary}</strong>
                  <span>Annotated talks will be surfaced here once slide notes exist.</span>
                </div>
              </section>
            </section>
          )}

          {destination === 'settings' && (
            <section className="page-stack">
              <div className="overview-grid">
                <section className="surface-panel">
                  <div className="surface-panel-header">
                    <h2>Application settings</h2>
                    <p>Placeholder surface for app-wide preferences.</p>
                  </div>
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
                        {info ? `${info.appName} · ${info.electronVersion}` : 'Loading...'}
                      </strong>
                    </div>
                  </div>
                </section>
                <section className="surface-panel">
                  <div className="surface-panel-header">
                    <h3>Current event context</h3>
                    <p>Event ownership persists while moving between agenda-related views.</p>
                  </div>
                  <div className="event-context">
                    <strong>{currentEvent.title}</strong>
                    <span>{currentEvent.dates}</span>
                    <span>{currentEvent.host}</span>
                  </div>
                </section>
              </div>
            </section>
          )}
        </main>
      </section>
    </div>
  );
}
