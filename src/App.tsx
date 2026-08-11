import React from 'react';

import darkBrandIcon from '../assets/icons/indicoink-dark.png';
import lightBrandIcon from '../assets/icons/indicoink-light.png';

import {
  agendaCanvasColumnWidth as layoutAgendaCanvasColumnWidth,
  agendaTimeGutterWidth as layoutAgendaTimeGutterWidth,
  buildAgendaCanvasLayout,
  getResponsiveAgendaColumnWidth,
  formatAgendaClockFromMinutes as layoutFormatAgendaClockFromMinutes,
} from './agendaCanvasLayout';
import type { AppInfo } from './shared/appInfo';
import type { AppSettings } from './shared/appSettings';
import { DEFAULT_PEN_THICKNESS } from './strokeTools';
import type {
  AgendaTalkMaterialSummary,
  AgendaTalkSummary,
} from './shared/agenda';
import type { LibraryEventSummary } from './shared/library';
import type { DeckCacheDownloadStatus } from './shared/deckCache';
import type {
  AgendaDownloadStatus,
  AgendaDownloadSummary,
} from './shared/agendaDownload';
import {
  formatAgendaTalkForTimeZone,
  type AgendaTimeZoneMode,
} from './agendaTime';
import type { ExportRenderedSlide } from './shared/exportNotes';
import type { ExportRenderedNotePage } from './shared/exportNotes';
import type {
  RefreshConflict,
  RefreshLibraryEventResult,
} from './shared/library';
import type { IndicoApiKeySummary } from './shared/indicoCredentials';
import {
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  OPENAI_REASONING_EFFORTS,
  type OpenAiConfigurationSummary,
  type OpenAiReasoningEffort,
} from './shared/openAi';
import { copyTextToClipboard } from './clipboard';
import {
  parseIndicoEventLinkUrl,
  parseIndicoEventSessionUrl,
} from './indicoEvent';
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
} from './ui';
import { PdfPreview } from './PdfPreview';
import {
  buildConferenceNotesMarkdown,
  collectExportRenderJobs,
  renderAnnotatedSlidePng,
  renderAnnotatedNotePagePng,
} from './exportNotes';
import { createExportFileName } from './exportFileName';

type Destination =
  | 'library'
  | 'agenda'
  | 'slides'
  | 'search'
  | 'bookmarks'
  | 'annotated'
  | 'settings';

type EventSummary = LibraryEventSummary;

type ApiKeyDialogRequest =
  | {
      kind: 'event';
      origin: string;
      message: string;
      eventUrl: string;
    }
  | {
      kind: 'deck';
      origin: string;
      message: string;
      conferenceId: string;
      talkId: string;
      deckId: string;
    }
  | {
      kind: 'refresh';
      origin: string;
      message: string;
      eventUrl: string;
      decision?: 'keep' | 'replace';
    };

type OpenAiDialogRequest = {
  operation: 'event' | 'refresh' | 'settings';
  reason: 'missing' | 'authentication-failed' | 'settings';
  message: string;
  eventUrl?: string;
  decision?: 'keep' | 'replace';
};

const destinations: Array<{
  id: Destination;
  label: string;
  shortLabel: string;
  icon: React.ComponentProps<typeof NavButton>['icon'];
}> = [
  { id: 'library', label: 'Library', shortLabel: 'Lib', icon: 'library' },
  { id: 'search', label: 'Search', shortLabel: 'Find', icon: 'search' },
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
  sourceKind: 'indico',
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

const isEditableKeyboardTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT');

const agendaDayLabelPattern =
  /^([A-Za-z]+),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/;

const agendaMonthShortNames: Record<string, string> = {
  January: 'Jan',
  February: 'Feb',
  March: 'Mar',
  April: 'Apr',
  May: 'May',
  June: 'Jun',
  July: 'Jul',
  August: 'Aug',
  September: 'Sep',
  October: 'Oct',
  November: 'Nov',
  December: 'Dec',
};

function formatAgendaDayTickerLabel(dayLabel: string) {
  const match = dayLabel.match(agendaDayLabelPattern);

  if (!match) {
    return dayLabel;
  }

  const weekday = match[1];
  const month = match[2];
  const day = match[3];
  if (!weekday || !month || !day) {
    return dayLabel;
  }

  const shortMonth = agendaMonthShortNames[month] ?? month;

  return `${weekday.slice(0, 3)} ${shortMonth} ${day}`;
}

function formatAgendaDateRangeLabel(dates: string) {
  const normalized = dates.trim();
  const match = normalized.match(
    /^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?(?:\s*-\s*([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?)?$/,
  );

  if (!match) {
    return normalized;
  }

  const startMonth = match[1];
  const startDay = match[2];
  const startYear = match[3];
  const endMonth = match[4];
  const endDay = match[5];
  const endYear = match[6];
  if (!startMonth || !startDay) {
    return normalized;
  }

  const shortStartMonth = agendaMonthShortNames[startMonth] ?? startMonth;
  const shortEndMonth = endMonth
    ? (agendaMonthShortNames[endMonth] ?? endMonth)
    : shortStartMonth;
  const resolvedStartYear = startYear ?? endYear ?? '';
  const resolvedEndYear = endYear ?? startYear ?? '';

  if (!endMonth || !endDay) {
    return resolvedStartYear
      ? `${shortStartMonth} ${startDay}, ${resolvedStartYear}`
      : `${shortStartMonth} ${startDay}`;
  }

  if (
    resolvedStartYear &&
    resolvedEndYear &&
    resolvedStartYear !== resolvedEndYear
  ) {
    return `${shortStartMonth} ${startDay}, ${resolvedStartYear} - ${shortEndMonth} ${endDay}, ${resolvedEndYear}`;
  }

  if (resolvedStartYear) {
    return `${shortStartMonth} ${startDay}-${shortEndMonth} ${endDay}, ${resolvedStartYear}`;
  }

  return `${shortStartMonth} ${startDay}-${shortEndMonth} ${endDay}`;
}

type GalleryFilter = (typeof filterOptions)[number]['value'];

type ExportProgressState =
  | { kind: 'idle' }
  | { kind: 'preparing'; label: string }
  | { kind: 'rendering'; label: string; completed: number; total: number }
  | { kind: 'writing'; label: string; completed: number; total: number }
  | { kind: 'done'; label: string; filePath: string }
  | { kind: 'empty'; label: string }
  | { kind: 'error'; label: string }
  | { kind: 'canceled'; label: string };

const validateEventUrl = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Paste an event or agenda webpage URL.';
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'Enter a valid http or https URL.';
  }

  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    return 'Use https://. http:// is allowed only for local testing.';
  }

  return null;
};

const formatByteCount = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    return '0 B';
  }

  if (value < 1024) {
    return `${Math.round(value)} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaledValue = value / 1024;
  let unitIndex = 0;

  while (scaledValue >= 1024 && unitIndex < units.length - 1) {
    scaledValue /= 1024;
    unitIndex += 1;
  }

  return `${scaledValue >= 10 ? scaledValue.toFixed(1) : scaledValue.toFixed(2)} ${units[unitIndex]}`;
};

const formatDuration = (milliseconds: number) => {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatTransferRate = (bytesPerSecond: number | null) => {
  if (
    !bytesPerSecond ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond <= 0
  ) {
    return 'Calculating rate...';
  }

  return `${formatByteCount(bytesPerSecond)}/s`;
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

function getAgendaTalkSearchText(talk: AgendaTalkSummary) {
  return [
    talk.title,
    talk.speaker,
    talk.sessionTitle,
    talk.contributionId,
    talk.dayLabel,
    talk.timeRangeLabel,
    talk.room,
    talk.materialSummary,
    ...talk.materials.map((material) => material.title),
  ]
    .join(' ')
    .toLowerCase();
}

function talkMatchesSearchQuery(talk: AgendaTalkSummary, query: string) {
  if (!query) {
    return true;
  }

  const searchText = getAgendaTalkSearchText(talk);
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => searchText.includes(part));
}

function getSelectedTalkDeck(talk: AgendaTalkSummary) {
  return (
    talk.materials.find(
      (material) =>
        material.mimeType === 'application/pdf' && material.selected,
    ) ??
    talk.materials.find(
      (material) => material.mimeType === 'application/pdf',
    ) ??
    null
  );
}

function getAgendaTalkPdfMaterials(talk: AgendaTalkSummary) {
  return talk.materials.filter(
    (material) => material.mimeType === 'application/pdf',
  );
}

function shouldShowAgendaTalkMaterials(talk: AgendaTalkSummary) {
  return (
    getAgendaTalkPdfMaterials(talk).length > 1 ||
    talk.materials.some(
      (material) => material.mimeType !== 'application/pdf',
    ) ||
    Boolean(talk.upstreamSummary)
  );
}

function formatAgendaTalkDeckChipLabel(talk: AgendaTalkSummary) {
  const selectedDeck = getSelectedTalkDeck(talk);
  if (!selectedDeck) {
    return null;
  }

  return getAgendaTalkPdfMaterials(talk).length > 1
    ? `Default deck: ${selectedDeck.title}`
    : null;
}

function getAgendaTalkPrimaryAction(talk: AgendaTalkSummary) {
  if (talk.entryKind === 'linked-agenda') {
    return {
      label: talk.linkedAgendaUrl ? 'Open linked agenda' : 'Linked agenda',
      ariaLabel: talk.linkedAgendaUrl
        ? `Open linked agenda for ${talk.title}`
        : `Linked agenda ${talk.title}`,
      kind: 'linked-agenda' as const,
    };
  }
  const selectedDeck = getSelectedTalkDeck(talk);
  if (selectedDeck) {
    return {
      label: 'Open slides',
      ariaLabel: `Open talk for ${talk.title}`,
      kind: 'slides' as const,
    };
  }

  if (talk.materials.length > 0) {
    return {
      label: 'Open materials',
      ariaLabel: `Open talk for ${talk.title}`,
      kind: 'materials' as const,
    };
  }

  return {
    label: 'Open notes',
    ariaLabel: `Open notes for ${talk.title}`,
    kind: 'notes' as const,
  };
}

function formatMaterialLabel(material: AgendaTalkMaterialSummary) {
  if (material.mimeType === 'application/pdf') {
    const pageLabel =
      material.pageCount && material.pageCount > 0
        ? ` · ${material.pageCount} page${material.pageCount === 1 ? '' : 's'}`
        : '';
    return `${material.title}${pageLabel}`;
  }

  return `${material.title} · ${material.mimeType}`;
}

function formatApiKeyUpdatedAt(updatedAt: number) {
  if (updatedAt <= 0) {
    return 'Saved key';
  }

  return `Saved ${new Date(updatedAt).toLocaleString()}`;
}

type SlideViewerState =
  | {
      kind: 'closed';
    }
  | {
      kind: 'loading';
      conferenceId: string;
      talkId: string;
      deckId: string;
      filePath: string | null;
      title: string;
      selectedMaterialId: string;
      materials: AgendaTalkMaterialSummary[];
      downloadStatus: DeckCacheDownloadStatus | null;
    }
  | {
      kind: 'ready';
      conferenceId: string;
      talkId: string;
      deckId: string;
      filePath: string;
      title: string;
      selectedMaterialId: string;
      materials: AgendaTalkMaterialSummary[];
      downloadStatus: DeckCacheDownloadStatus | null;
    }
  | {
      kind: 'error';
      conferenceId: string;
      talkId: string;
      deckId: string;
      filePath: string | null;
      title: string;
      selectedMaterialId: string;
      materials: AgendaTalkMaterialSummary[];
      downloadStatus: DeckCacheDownloadStatus | null;
      message: string;
    };

type ViewerMode = 'slides' | 'notes';

function AgendaTimelineCanvas({
  visibleAgendaTalks,
  selectedAgendaTalkId,
  viewportRef,
  onOpenTalk,
  onOpenTalkSlides,
  onOpenTalkNotes,
  onOpenTalkMaterials,
  onOpenLinkedAgenda,
  onOpenLinkedAgendaInApp,
  onCopyLinkedAgenda,
  onToggleBookmark,
}: {
  visibleAgendaTalks: AgendaTalkSummary[];
  selectedAgendaTalkId: string | null;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onOpenTalk: (talk: AgendaTalkSummary) => void;
  onOpenTalkSlides: (talk: AgendaTalkSummary) => void;
  onOpenTalkNotes: (talk: AgendaTalkSummary) => void;
  onOpenTalkMaterials: (talk: AgendaTalkSummary) => void;
  onOpenLinkedAgenda: (talk: AgendaTalkSummary) => void;
  onOpenLinkedAgendaInApp: (talk: AgendaTalkSummary) => void;
  onCopyLinkedAgenda: (
    talk: AgendaTalkSummary,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  onToggleBookmark: (talk: AgendaTalkSummary) => void;
}) {
  const [viewportWidthPx, setViewportWidthPx] = React.useState(
    layoutAgendaTimeGutterWidth + layoutAgendaCanvasColumnWidth * 3,
  );
  const [measuredTalkHeightsPx, setMeasuredTalkHeightsPx] = React.useState<
    Record<string, number>
  >({});
  const talkCardElementsRef = React.useRef(new Map<string, HTMLElement>());
  const talkCardResizeObserverRef = React.useRef<ResizeObserver | null>(null);

  React.useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const nextMeasurements: Record<string, number> = {};
      entries.forEach((entry) => {
        const talkId = (entry.target as HTMLElement).dataset.talkId;
        if (!talkId) {
          return;
        }

        nextMeasurements[talkId] = Math.ceil(
          entry.target.getBoundingClientRect().height,
        );
      });

      setMeasuredTalkHeightsPx((currentMeasurements) => {
        const changedEntries = Object.entries(nextMeasurements).filter(
          ([talkId, heightPx]) =>
            Math.abs((currentMeasurements[talkId] ?? 0) - heightPx) > 1,
        );
        if (changedEntries.length === 0) {
          return currentMeasurements;
        }

        return {
          ...currentMeasurements,
          ...Object.fromEntries(changedEntries),
        };
      });
    });

    talkCardResizeObserverRef.current = observer;
    talkCardElementsRef.current.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      talkCardResizeObserverRef.current = null;
    };
  }, []);

  const registerTalkCard = React.useCallback(
    (talkId: string, element: HTMLElement | null) => {
      const previousElement = talkCardElementsRef.current.get(talkId);
      if (previousElement && previousElement !== element) {
        talkCardResizeObserverRef.current?.unobserve(previousElement);
      }

      if (!element) {
        talkCardElementsRef.current.delete(talkId);
        return;
      }

      talkCardElementsRef.current.set(talkId, element);
      talkCardResizeObserverRef.current?.observe(element);
    },
    [],
  );

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    const updateViewportWidth = () => {
      const nextViewportWidthPx = Math.round(viewport.clientWidth);
      setViewportWidthPx((currentViewportWidthPx) =>
        currentViewportWidthPx === nextViewportWidthPx
          ? currentViewportWidthPx
          : nextViewportWidthPx,
      );
    };

    updateViewportWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportWidth);
      return () => {
        window.removeEventListener('resize', updateViewportWidth);
      };
    }

    const observer = new ResizeObserver(updateViewportWidth);
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [viewportRef]);

  const provisionalLayout = React.useMemo(
    () => buildAgendaCanvasLayout(visibleAgendaTalks),
    [visibleAgendaTalks],
  );
  const responsiveColumnWidthPx = React.useMemo(
    () =>
      getResponsiveAgendaColumnWidth(
        viewportWidthPx,
        provisionalLayout.columnCount,
      ),
    [provisionalLayout.columnCount, viewportWidthPx],
  );
  const layout = React.useMemo(
    () =>
      buildAgendaCanvasLayout(visibleAgendaTalks, {
        columnWidthPx: responsiveColumnWidthPx,
        measuredTalkHeightsPx,
      }),
    [visibleAgendaTalks, responsiveColumnWidthPx, measuredTalkHeightsPx],
  );

  return (
    <div className="agenda-canvas-shell">
      <div className="agenda-canvas-scroll" aria-label="Agenda day canvas">
        <div
          className="agenda-time-gutter-mask"
          aria-hidden="true"
          style={{
            height: `${layout.canvasHeightPx}px`,
          }}
        />
        <div
          className="agenda-canvas-grid agenda-canvas-grid--absolute"
          style={{
            width: `${layout.canvasWidthPx}px`,
            height: `${layout.canvasHeightPx}px`,
          }}
        >
          <div
            className="agenda-time-gutter agenda-time-gutter--absolute"
            aria-hidden="true"
            style={{
              height: `${layout.canvasHeightPx}px`,
            }}
          >
            <div className="agenda-time-gutter-header">
              <span>Time</span>
              <small>(UTC)</small>
            </div>
            {layout.timeMarkers.map((minute) => {
              const markerIndex = layout.timeMarkers.indexOf(minute);
              const markerTop = layout.timeMarkerTopPx[markerIndex] ?? 0;

              return (
                <div
                  key={minute}
                  className="agenda-time-marker agenda-time-marker--absolute"
                  style={{
                    top: `${Math.max(0, markerTop)}px`,
                  }}
                >
                  <span>{layoutFormatAgendaClockFromMinutes(minute)}</span>
                </div>
              );
            })}
          </div>

          {layout.columns.map((block) => {
            return (
              <section
                key={block.key}
                className={`agenda-session-block agenda-session-block--absolute${block.spanFullWidth ? ' agenda-session-block--shared' : ''}`}
                style={{
                  top: `${block.blockTopPx}px`,
                  left: `${layoutAgendaTimeGutterWidth + (block.spanFullWidth ? 0 : Math.max(0, block.columnIndex) * layout.columnWidthPx)}px`,
                  width: `${block.spanFullWidth ? layout.canvasWidthPx - layoutAgendaTimeGutterWidth : layout.columnWidthPx}px`,
                  height: `${block.trackHeightPx}px`,
                }}
                aria-label={`${block.title} session on ${block.dayLabel}`}
              >
                <div className="agenda-session-block-header">
                  <div className="agenda-session-block-heading">
                    <h4>{block.title}</h4>
                    <p>
                      {block.startLabel} - {block.endLabel}
                    </p>
                  </div>
                  <StatusLabel label={block.room} tone="neutral" icon="info" />
                </div>
                <div
                  className="agenda-session-track"
                  style={{
                    height: `${block.trackHeightPx}px`,
                  }}
                >
                  {block.talkPlacements.map(({ talk, topPx, heightPx }) => {
                    const talkDeckChipLabel =
                      formatAgendaTalkDeckChipLabel(talk);
                    const talkHasMaterials =
                      shouldShowAgendaTalkMaterials(talk);
                    const primaryAction = getAgendaTalkPrimaryAction(talk);
                    const showMaterialsAction =
                      talkHasMaterials && primaryAction.kind === 'slides';

                    return (
                      <div
                        key={talk.id}
                        className="agenda-talk-placement"
                        style={{
                          top: `${topPx}px`,
                          height: `${heightPx}px`,
                        }}
                      >
                        <article
                          ref={(element) => registerTalkCard(talk.id, element)}
                          data-talk-id={talk.id}
                          className={`agenda-talk-card${talk.id === selectedAgendaTalkId ? ' is-selected' : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-label={primaryAction.ariaLabel}
                          aria-current={
                            talk.id === selectedAgendaTalkId
                              ? 'true'
                              : undefined
                          }
                          onClick={() => {
                            if (primaryAction.kind === 'linked-agenda') {
                              onOpenLinkedAgenda(talk);
                              return;
                            }
                            if (primaryAction.kind === 'slides') {
                              onOpenTalkSlides(talk);
                              return;
                            }

                            if (primaryAction.kind === 'notes') {
                              onOpenTalkNotes(talk);
                              return;
                            }

                            if (primaryAction.kind === 'materials') {
                              onOpenTalkMaterials(talk);
                              return;
                            }

                            onOpenTalk(talk);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              if (primaryAction.kind === 'linked-agenda') {
                                onOpenLinkedAgenda(talk);
                                return;
                              }
                              if (primaryAction.kind === 'slides') {
                                onOpenTalkSlides(talk);
                                return;
                              }

                              if (primaryAction.kind === 'notes') {
                                onOpenTalkNotes(talk);
                                return;
                              }

                              if (primaryAction.kind === 'materials') {
                                onOpenTalkMaterials(talk);
                                return;
                              }

                              onOpenTalk(talk);
                            }
                          }}
                        >
                          <div className="agenda-talk-card-topline">
                            <span className="agenda-talk-card-time">
                              {talk.timeRangeLabel}
                            </span>
                            <div
                              className="agenda-talk-card-bookmark"
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                            >
                              <IconButton
                                label={
                                  talk.bookmarked
                                    ? 'Remove bookmark'
                                    : 'Bookmark talk'
                                }
                                icon="bookmark"
                                pressed={talk.bookmarked}
                                title={
                                  talk.bookmarked
                                    ? 'Remove bookmark'
                                    : 'Bookmark talk'
                                }
                                onClick={() => {
                                  void onToggleBookmark(talk);
                                }}
                              />
                            </div>
                          </div>
                          <div className="agenda-talk-card-title">
                            {talk.title}
                          </div>
                          <div className="agenda-talk-card-speaker">
                            {talk.entryKind === 'linked-agenda'
                              ? 'Linked Indico agenda'
                              : talk.speaker}
                            {talk.room !== 'Room unavailable' &&
                            talk.room !== block.room
                              ? ` - ${talk.room}`
                              : ''}
                          </div>
                          {talk.entryKind !== 'linked-agenda' ? (
                            <div className="agenda-talk-card-meta">
                              <StatusLabel
                                label={talk.materialSummary}
                                tone="neutral"
                                icon="open"
                              />
                              {talkDeckChipLabel ? (
                                <div className="agenda-talk-card-default-deck">
                                  {talkDeckChipLabel}
                                </div>
                              ) : null}
                              {talk.annotatedSlideCount > 0 ? (
                                <StatusLabel
                                  label={`${talk.annotatedSlideCount} annotated slide${talk.annotatedSlideCount === 1 ? '' : 's'}`}
                                  tone="warning"
                                  icon="annotated"
                                />
                              ) : null}
                            </div>
                          ) : null}
                          {talk.entryKind === 'linked-agenda' &&
                          talk.linkedAgendaUrl ? (
                            <div className="agenda-talk-card-actions">
                              <IconButton
                                label={`Open URL for ${talk.title}`}
                                title="Open URL"
                                icon="open"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onOpenLinkedAgenda(talk);
                                }}
                              />
                              <IconButton
                                label={`Copy URL for ${talk.title}`}
                                title="Copy URL"
                                icon="copy"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onCopyLinkedAgenda(talk, event);
                                }}
                              />
                              <IconButton
                                label={`Open ${talk.title} in IndicoInk`}
                                title="Open in IndicoInk"
                                icon="event"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onOpenLinkedAgendaInApp(talk);
                                }}
                              />
                            </div>
                          ) : null}
                          {talk.entryKind !== 'linked-agenda' ? (
                            <div className="agenda-talk-card-actions">
                              <IconButton
                                label={`Open notes for ${talk.title}`}
                                title="Open notes"
                                icon="pen"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenTalkNotes(talk);
                                }}
                              />
                              {showMaterialsAction ? (
                                <button
                                  className="agenda-talk-card-action-button agenda-talk-card-action-button--secondary"
                                  type="button"
                                  aria-label={`Materials for ${talk.title}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenTalkMaterials(talk);
                                  }}
                                >
                                  <Icon name="dialog" />
                                  <span>Materials</span>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ResizableNotesWorkspace({
  reference,
  children,
}: {
  reference: React.ReactNode;
  children: React.ReactNode;
}) {
  const workspaceRef = React.useRef<HTMLDivElement | null>(null);
  const [referenceRatio, setReferenceRatio] = React.useState(0.42);
  const [isPortrait, setIsPortrait] = React.useState(false);
  const dragStateRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startRatio: number;
  } | null>(null);

  React.useEffect(() => {
    const element = workspaceRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const updateOrientation = () => {
      setIsPortrait(element.clientHeight > element.clientWidth);
    };
    updateOrientation();
    const observer = new ResizeObserver(updateOrientation);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handlePointerMove = React.useCallback(
    (event: PointerEvent) => {
      const drag = dragStateRef.current;
      const element = workspaceRef.current;
      if (!drag || !element || event.pointerId !== drag.pointerId) {
        return;
      }
      const bounds = element.getBoundingClientRect();
      const delta = isPortrait
        ? (event.clientY - drag.startY) / Math.max(1, bounds.height)
        : (event.clientX - drag.startX) / Math.max(1, bounds.width);
      setReferenceRatio(Math.min(0.7, Math.max(0.25, drag.startRatio + delta)));
    },
    [isPortrait],
  );

  const stopDragging = React.useCallback(
    (event: PointerEvent) => {
      if (dragStateRef.current?.pointerId !== event.pointerId) {
        return;
      }
      dragStateRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    },
    [handlePointerMove],
  );

  React.useEffect(
    () => () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    },
    [handlePointerMove, stopDragging],
  );

  const startDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRatio: referenceRatio,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
  };

  const adjustRatio = (delta: number) => {
    setReferenceRatio((current) =>
      Math.min(0.7, Math.max(0.25, current + delta)),
    );
  };

  return (
    <div
      ref={workspaceRef}
      className={`notes-workspace${isPortrait ? ' is-portrait' : ''}`}
      style={
        { '--notes-reference-ratio': referenceRatio } as React.CSSProperties
      }
    >
      <div className="notes-reference-pane">{reference}</div>
      <div
        className="notes-workspace-divider"
        role="separator"
        aria-label="Resize reference slide and notes"
        aria-orientation={isPortrait ? 'horizontal' : 'vertical'}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            adjustRatio(-0.05);
          }
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            adjustRatio(0.05);
          }
        }}
        onPointerDown={startDragging}
      />
      <div className="notes-editor-pane">{children}</div>
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
  const [apiKeyDialogRequest, setApiKeyDialogRequest] =
    React.useState<ApiKeyDialogRequest | null>(null);
  const [apiKeyValue, setApiKeyValue] = React.useState('');
  const [apiKeyError, setApiKeyError] = React.useState<string | null>(null);
  const [isSavingApiKey, setIsSavingApiKey] = React.useState(false);
  const [openAiDialogRequest, setOpenAiDialogRequest] =
    React.useState<OpenAiDialogRequest | null>(null);
  const [openAiConfiguration, setOpenAiConfiguration] =
    React.useState<OpenAiConfigurationSummary | null>(null);
  const [openAiBaseUrl, setOpenAiBaseUrl] = React.useState(
    OPENAI_DEFAULT_BASE_URL,
  );
  const [openAiModel, setOpenAiModel] = React.useState(OPENAI_DEFAULT_MODEL);
  const [openAiReasoningEffort, setOpenAiReasoningEffort] =
    React.useState<OpenAiReasoningEffort>('medium');
  const [openAiApiKey, setOpenAiApiKey] = React.useState('');
  const [openAiError, setOpenAiError] = React.useState<string | null>(null);
  const [isSavingOpenAi, setIsSavingOpenAi] = React.useState(false);
  const [info, setInfo] = React.useState<AppInfo | null>(null);
  const appVersionText = info ? info.appVersion : 'Loading...';
  const electronVersionText = info ? info.electronVersion : 'Loading...';
  const [dataFolderPath, setDataFolderPath] = React.useState<string>('');
  const [appSettings, setAppSettings] = React.useState<AppSettings | null>(
    null,
  );
  const [isSavingAppSettings, setIsSavingAppSettings] = React.useState(false);
  const [appSettingsError, setAppSettingsError] = React.useState<string | null>(
    null,
  );
  const [apiKeySummaries, setApiKeySummaries] = React.useState<
    IndicoApiKeySummary[]
  >([]);
  const [apiKeyDeleteTarget, setApiKeyDeleteTarget] =
    React.useState<IndicoApiKeySummary | null>(null);
  const [libraryEvents, setLibraryEvents] = React.useState<EventSummary[]>([]);
  const [selectedEventId, setSelectedEventId] = React.useState<string | null>(
    null,
  );
  const [agendaTalks, setAgendaTalks] = React.useState<AgendaTalkSummary[]>([]);
  const [agendaReloadVersion, setAgendaReloadVersion] = React.useState(0);
  const [agendaTalksLoading, setAgendaTalksLoading] = React.useState(false);
  const [agendaTalksError, setAgendaTalksError] = React.useState<string | null>(
    null,
  );
  const [agendaDownloadStatus, setAgendaDownloadStatus] =
    React.useState<AgendaDownloadStatus | null>(null);
  const [agendaDownloadSummary, setAgendaDownloadSummary] =
    React.useState<AgendaDownloadSummary | null>(null);
  const [agendaDownloadBannerVisible, setAgendaDownloadBannerVisible] =
    React.useState(false);
  const [agendaDayLabel, setAgendaDayLabel] = React.useState<string | null>(
    null,
  );
  const [selectedAgendaTalkId, setSelectedAgendaTalkId] = React.useState<
    string | null
  >(null);
  const [agendaMaterialsTalkId, setAgendaMaterialsTalkId] = React.useState<
    string | null
  >(null);
  const [agendaSearchQuery, setAgendaSearchQuery] = React.useState('');
  const [agendaFilter, setAgendaFilter] = React.useState<GalleryFilter>('all');
  const [agendaTimeZoneMode, setAgendaTimeZoneMode] =
    React.useState<AgendaTimeZoneMode>('event');
  const [deleteTarget, setDeleteTarget] = React.useState<EventSummary | null>(
    null,
  );
  const [refreshState, setRefreshState] = React.useState<
    | { kind: 'idle' }
    | { kind: 'checking'; message: string }
    | { kind: 'conflict'; message: string; conflicts: RefreshConflict[] }
    | { kind: 'refreshing'; message: string }
    | { kind: 'done'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [slideViewerState, setSlideViewerState] =
    React.useState<SlideViewerState>({ kind: 'closed' });
  const [viewerMode, setViewerMode] = React.useState<ViewerMode>('slides');
  const [notesDeckId, setNotesDeckId] = React.useState<string | null>(null);
  const [, setSlideViewerMetrics] = React.useState<{
    currentSlideNumber: number;
    currentPageCount: number;
  }>({ currentSlideNumber: 1, currentPageCount: 0 });
  const agendaScrollFrameRef = React.useRef<number | null>(null);
  const agendaScrollPositionsRef = React.useRef(
    new Map<string, { scrollLeft: number; scrollTop: number }>(),
  );
  const agendaTalksLoadedEventIdRef = React.useRef<string | null>(null);
  const agendaRefreshCompletionMessageRef = React.useRef<string | null>(null);
  const agendaCanvasMeasureRef = React.useRef<HTMLDivElement | null>(null);
  const pageSurfaceRef = React.useRef<HTMLElement | null>(null);
  const agendaSearchInputRef = React.useRef<HTMLInputElement | null>(null);
  const deckDownloadPollRef = React.useRef<number | null>(null);
  const agendaDownloadPollRef = React.useRef<number | null>(null);
  const exportCancellationRef = React.useRef<{ cancelled: boolean } | null>(
    null,
  );
  const [exportState, setExportState] = React.useState<ExportProgressState>({
    kind: 'idle',
  });
  const [copyTooltip, setCopyTooltip] = React.useState<{
    message: string;
    x: number;
    y: number;
  } | null>(null);
  const copyTooltipTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    void window.indicoInk.getAppInfo().then(setInfo);
  }, []);

  React.useEffect(() => {
    void window.indicoInk.getDataFolder().then(setDataFolderPath);
  }, []);

  React.useEffect(() => {
    void window.indicoInk.getAppSettings().then(setAppSettings);
  }, []);

  React.useEffect(
    () =>
      window.indicoInk.onWebAgendaProgress(({ operation, stage }) => {
        const message =
          stage === 'fetching-webpage'
            ? operation === 'refresh'
              ? 'Refreshing from webpage: fetching webpage...'
              : 'Fetching webpage...'
            : operation === 'refresh'
              ? 'Refreshing from webpage: extracting agenda...'
              : 'Extracting agenda...';
        if (operation === 'refresh') {
          setRefreshState({ kind: 'checking', message });
        } else {
          setOpenEventFeedback({ tone: 'neutral', message });
        }
      }),
    [],
  );

  React.useEffect(
    () => () => {
      if (copyTooltipTimerRef.current !== null) {
        window.clearTimeout(copyTooltipTimerRef.current);
      }
    },
    [],
  );

  const refreshLibraryEvents = React.useCallback(async () => {
    const events = await window.indicoInk.listLibraryEvents();
    setLibraryEvents(events ?? []);
  }, []);

  const refreshIndicoApiKeys = React.useCallback(async () => {
    const apiKeys = await window.indicoInk.listIndicoApiKeys();
    setApiKeySummaries(apiKeys);
  }, []);

  const refreshOpenAiConfiguration = React.useCallback(async () => {
    const configuration = await window.indicoInk.getOpenAiConfiguration();
    setOpenAiConfiguration(configuration);
    return configuration;
  }, []);

  const showOpenAiConfigurationDialog = React.useCallback(
    async (request: OpenAiDialogRequest) => {
      const configuration = await refreshOpenAiConfiguration();
      setOpenAiBaseUrl(configuration.baseUrl);
      setOpenAiModel(configuration.model);
      setOpenAiReasoningEffort(configuration.reasoningEffort);
      setOpenAiApiKey('');
      setOpenAiError(
        request.reason === 'authentication-failed' ? request.message : null,
      );
      setOpenAiDialogRequest(request);
    },
    [refreshOpenAiConfiguration],
  );

  const setRecordLoggingEnabled = React.useCallback(
    async (enabled: boolean) => {
      setIsSavingAppSettings(true);
      setAppSettingsError(null);
      try {
        const updatedSettings = await window.indicoInk.setAppSettings({
          ...(appSettings ?? {
            recordLogging: false,
            penThickness: DEFAULT_PEN_THICKNESS,
            openAiBaseUrl: OPENAI_DEFAULT_BASE_URL,
            openAiModel: OPENAI_DEFAULT_MODEL,
            openAiReasoningEffort: 'medium' as const,
          }),
          recordLogging: enabled,
        });
        setAppSettings(updatedSettings);
      } catch (error) {
        setAppSettingsError(
          error instanceof Error
            ? error.message
            : 'Failed to save logging settings.',
        );
      } finally {
        setIsSavingAppSettings(false);
      }
    },
    [appSettings],
  );

  const setPenThickness = React.useCallback(
    async (penThickness: number) => {
      setAppSettingsError(null);
      try {
        const updatedSettings = await window.indicoInk.setAppSettings({
          ...(appSettings ?? {
            recordLogging: false,
            penThickness: DEFAULT_PEN_THICKNESS,
            openAiBaseUrl: OPENAI_DEFAULT_BASE_URL,
            openAiModel: OPENAI_DEFAULT_MODEL,
            openAiReasoningEffort: 'medium' as const,
          }),
          penThickness,
        });
        setAppSettings(updatedSettings);
      } catch (error) {
        setAppSettingsError(
          error instanceof Error
            ? error.message
            : 'Failed to save pen thickness.',
        );
      }
    },
    [appSettings],
  );

  const returnToLibrary = React.useCallback(async () => {
    await refreshLibraryEvents();
    setDestination('library');
  }, [refreshLibraryEvents]);

  React.useEffect(() => {
    if (destination !== 'search') {
      return;
    }

    agendaSearchInputRef.current?.focus();
  }, [destination]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (event.ctrlKey && !event.metaKey && key === 'f') {
        event.preventDefault();
        setDestination('search');
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'l') {
        event.preventDefault();
        void returnToLibrary();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [returnToLibrary]);

  const refreshSelectedEvent = React.useCallback(
    async (decision?: 'keep' | 'replace') => {
      const event = libraryEvents.find((item) => item.id === selectedEventId);
      if (!event) {
        agendaRefreshCompletionMessageRef.current = null;
        setRefreshState({
          kind: 'error',
          message: 'Open an event before refreshing it.',
        });
        return;
      }

      const scrollContainer = pageSurfaceRef.current;
      if (destination === 'agenda' && scrollContainer) {
        agendaScrollPositionsRef.current.set(
          `${event.id}::${agendaDayLabel ?? ''}`,
          {
            scrollLeft: scrollContainer.scrollLeft,
            scrollTop: scrollContainer.scrollTop,
          },
        );
      }

      setRefreshState({
        kind: 'checking',
        message: `Checking ${event.title} for upstream changes...`,
      });

      try {
        const result: RefreshLibraryEventResult =
          await window.indicoInk.refreshLibraryEvent(event.sourceUrl, decision);

        if (result.kind === 'conflict') {
          agendaRefreshCompletionMessageRef.current = null;
          setRefreshState({
            kind: 'conflict',
            message: 'The upstream PDF changed for an annotated deck.',
            conflicts: result.conflicts,
          });
          return;
        }

        if (result.kind === 'api-key-required') {
          agendaRefreshCompletionMessageRef.current = null;
          setRefreshState({
            kind: 'error',
            message: result.message,
          });
          setApiKeyDialogRequest({
            kind: 'refresh',
            origin: result.origin,
            message: result.message,
            eventUrl: event.sourceUrl,
            ...(decision ? { decision } : {}),
          });
          setApiKeyValue('');
          setApiKeyError(result.message);
          return;
        }

        if (result.kind === 'llm-configuration-required') {
          agendaRefreshCompletionMessageRef.current = null;
          setRefreshState({ kind: 'error', message: result.message });
          await showOpenAiConfigurationDialog({
            operation: 'refresh',
            reason: result.reason,
            message: result.message,
            eventUrl: event.sourceUrl,
            ...(decision ? { decision } : {}),
          });
          return;
        }

        await refreshLibraryEvents();
        setAgendaReloadVersion((version) => version + 1);
        const completionMessage = `Refreshed ${result.title}: ${result.changedTalkCount} changed, ${result.removedTalkCount} removed, ${result.newlyAvailableDeckCount} new PDF${result.newlyAvailableDeckCount === 1 ? '' : 's'}.`;
        if (destination === 'agenda') {
          agendaRefreshCompletionMessageRef.current = completionMessage;
          setRefreshState({
            kind: 'refreshing',
            message: 'Updating the agenda…',
          });
        } else {
          setRefreshState({ kind: 'done', message: completionMessage });
        }
      } catch (error) {
        agendaRefreshCompletionMessageRef.current = null;
        setRefreshState({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to refresh the event.',
        });
      }
    },
    [
      agendaDayLabel,
      destination,
      libraryEvents,
      refreshLibraryEvents,
      selectedEventId,
      showOpenAiConfigurationDialog,
    ],
  );

  React.useEffect(() => {
    void refreshLibraryEvents();
  }, [refreshLibraryEvents]);

  React.useEffect(() => {
    void refreshIndicoApiKeys();
  }, [refreshIndicoApiKeys]);

  React.useEffect(() => {
    void refreshOpenAiConfiguration();
  }, [refreshOpenAiConfiguration]);

  const activeSlideDownloadStatus =
    slideViewerState.kind === 'closed' ? null : slideViewerState.downloadStatus;
  const activeSlideTitle =
    slideViewerState.kind === 'closed' ? '' : slideViewerState.title;
  const activeSlideMaterials =
    slideViewerState.kind === 'closed' ? [] : slideViewerState.materials;
  const activeSlideSelectedMaterialId =
    slideViewerState.kind === 'closed'
      ? null
      : slideViewerState.selectedMaterialId;
  const activeSlideSelectedMaterial =
    activeSlideMaterials.find(
      (material) => material.id === activeSlideSelectedMaterialId,
    ) ??
    activeSlideMaterials[0] ??
    null;
  const activeSlideConferenceId =
    slideViewerState.kind === 'closed' ? null : slideViewerState.conferenceId;
  const activeSlideTalkId =
    slideViewerState.kind === 'closed' ? null : slideViewerState.talkId;
  const activeSlideDeckId =
    slideViewerState.kind === 'closed' ? null : slideViewerState.deckId;
  const activeSlideDownloadProgress =
    activeSlideDownloadStatus?.kind === 'downloading'
      ? (() => {
          const elapsedMilliseconds = Math.max(
            0,
            Date.now() - activeSlideDownloadStatus.startedAt,
          );
          const bytesPerSecond =
            elapsedMilliseconds > 0
              ? activeSlideDownloadStatus.bytesDownloaded /
                (elapsedMilliseconds / 1000)
              : null;
          const percentComplete =
            activeSlideDownloadStatus.totalBytes &&
            activeSlideDownloadStatus.totalBytes > 0
              ? Math.min(
                  100,
                  (activeSlideDownloadStatus.bytesDownloaded /
                    activeSlideDownloadStatus.totalBytes) *
                    100,
                )
              : null;

          return {
            elapsedMilliseconds,
            bytesPerSecond,
            percentComplete,
          };
        })()
      : null;
  const activeSlideDownloadPercent =
    activeSlideDownloadProgress?.percentComplete ?? null;
  const activeAgendaDownloadTalks =
    agendaDownloadStatus?.conferenceId === selectedEventId
      ? agendaDownloadStatus.downloadedTalks
      : 0;
  const downloadedAgendaTalks = Math.max(
    agendaDownloadSummary?.downloadedTalks ?? 0,
    activeAgendaDownloadTalks,
  );
  const startAgendaDownload = async () => {
    if (!selectedEventId) {
      return;
    }

    try {
      const result =
        await window.indicoInk.startAgendaDownload(selectedEventId);
      const status = await window.indicoInk.getAgendaDownloadStatus(
        result.operationId,
      );
      if (status) {
        setAgendaDownloadStatus(status);
        setAgendaDownloadBannerVisible(true);
      }
    } catch (error) {
      setOpenEventFeedback({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to start the agenda download.',
      });
    }
  };
  const cancelAgendaDownload = async () => {
    if (!agendaDownloadStatus) {
      return;
    }

    await window.indicoInk.cancelAgendaDownload(
      agendaDownloadStatus.operationId,
    );
    const status = await window.indicoInk.getAgendaDownloadStatus(
      agendaDownloadStatus.operationId,
    );
    setAgendaDownloadStatus(status);
  };
  const commandBarStatus =
    destination === 'slides' ? (
      activeSlideDownloadStatus?.kind === 'downloading' ? (
        <StatusLabel
          label={
            activeSlideDownloadStatus.message ??
            `Downloading ${Math.round(
              activeSlideDownloadStatus.totalBytes
                ? (activeSlideDownloadStatus.bytesDownloaded /
                    activeSlideDownloadStatus.totalBytes) *
                    100
                : 0,
            )}%`
          }
          tone="neutral"
          icon="info"
        />
      ) : activeSlideDownloadStatus?.kind === 'error' ? (
        <StatusLabel
          label={activeSlideDownloadStatus.message ?? 'Download failed.'}
          tone="error"
          icon="info"
        />
      ) : activeSlideDownloadStatus?.kind === 'canceled' ? (
        <StatusLabel
          label={activeSlideDownloadStatus.message ?? 'Download canceled.'}
          tone="warning"
          icon="info"
        />
      ) : exportState.kind === 'preparing' ||
        exportState.kind === 'rendering' ||
        exportState.kind === 'writing' ? (
        <StatusLabel label={exportState.label} tone="neutral" icon="info" />
      ) : exportState.kind === 'error' ? (
        <StatusLabel label={exportState.label} tone="error" icon="info" />
      ) : exportState.kind === 'empty' || exportState.kind === 'canceled' ? (
        <StatusLabel label={exportState.label} tone="warning" icon="info" />
      ) : undefined
    ) : destination === 'library' ? undefined : exportState.kind ===
        'preparing' ||
      exportState.kind === 'rendering' ||
      exportState.kind === 'writing' ? (
      <StatusLabel label={exportState.label} tone="neutral" icon="info" />
    ) : exportState.kind === 'done' ? (
      <StatusLabel label={exportState.label} tone="success" icon="check" />
    ) : exportState.kind === 'error' ? (
      <StatusLabel label={exportState.label} tone="error" icon="info" />
    ) : exportState.kind === 'empty' ? (
      <StatusLabel label={exportState.label} tone="warning" icon="info" />
    ) : exportState.kind === 'canceled' ? (
      <StatusLabel label={exportState.label} tone="warning" icon="info" />
    ) : destination === 'settings' ? (
      <StatusLabel label="Settings" icon="settings" />
    ) : undefined;
  const commandBarActions =
    destination === 'library' || destination === 'settings' ? undefined : (
      <>
        {destination === 'slides' ? (
          <>
            {activeSlideMaterials.length > 1 ? (
              <SegmentedControl
                options={activeSlideMaterials.map((material) => ({
                  label: material.title,
                  value: material.id,
                }))}
                value={
                  activeSlideSelectedMaterialId ??
                  activeSlideMaterials[0]?.id ??
                  ''
                }
                onChange={(deckId) => {
                  void handleSelectSelectedTalkDeck(deckId);
                }}
              />
            ) : null}
            {activeSlideDownloadStatus?.kind === 'downloading' ? (
              <IconButton
                label="Cancel download"
                title="Cancel download"
                icon="trash"
                onClick={() => {
                  void handleCancelDeckDownload();
                }}
              />
            ) : activeSlideDownloadStatus?.kind === 'error' ? (
              <IconButton
                label="Retry download"
                title="Retry download"
                icon="refresh"
                onClick={() => {
                  void handleRetryDeckDownload();
                }}
              />
            ) : null}
            <PrimaryButton
              icon="export"
              onClick={() => {
                void handleExportNotes();
              }}
              disabled={
                !selectedEventId ||
                activeSlideDownloadStatus?.kind === 'downloading' ||
                activeSlideDownloadStatus?.kind === 'error' ||
                activeSlideDownloadStatus?.kind === 'canceled' ||
                exportState.kind === 'rendering' ||
                exportState.kind === 'writing' ||
                exportState.kind === 'preparing'
              }
            >
              Export notes
            </PrimaryButton>
          </>
        ) : destination === 'agenda' ? (
          <>
            <PrimaryButton
              icon="download"
              onClick={() => {
                void startAgendaDownload();
              }}
              disabled={
                !selectedEventId ||
                agendaDownloadStatus?.kind === 'queued' ||
                agendaDownloadStatus?.kind === 'downloading'
              }
            >
              Download Talks
            </PrimaryButton>
            <IconButton
              label="Refresh"
              title="Refresh event from source"
              icon="refresh"
              className={
                refreshState.kind === 'checking' ||
                refreshState.kind === 'refreshing' ||
                agendaTalksLoading
                  ? 'is-spinning'
                  : undefined
              }
              onClick={() => {
                void handleRefreshAction();
              }}
              disabled={
                !selectedEventId ||
                refreshState.kind === 'checking' ||
                refreshState.kind === 'refreshing' ||
                agendaTalksLoading
              }
            />
            <PrimaryButton
              icon="export"
              onClick={() => {
                void handleExportNotes();
              }}
              disabled={
                !selectedEventId ||
                exportState.kind === 'rendering' ||
                exportState.kind === 'writing' ||
                exportState.kind === 'preparing'
              }
            >
              Export notes
            </PrimaryButton>
          </>
        ) : (
          <>
            <IconButton
              label="Refresh"
              title="Refresh event from source"
              icon="refresh"
              className={
                refreshState.kind === 'checking' ||
                refreshState.kind === 'refreshing' ||
                agendaTalksLoading
                  ? 'is-spinning'
                  : undefined
              }
              onClick={() => {
                void handleRefreshAction();
              }}
              disabled={
                !selectedEventId ||
                refreshState.kind === 'checking' ||
                refreshState.kind === 'refreshing' ||
                agendaTalksLoading
              }
            />
            <PrimaryButton
              icon="export"
              onClick={() => {
                void handleExportNotes();
              }}
              disabled={
                !selectedEventId ||
                exportState.kind === 'rendering' ||
                exportState.kind === 'writing' ||
                exportState.kind === 'preparing'
              }
            >
              Export notes
            </PrimaryButton>
          </>
        )}
      </>
    );
  const activeEvent =
    libraryEvents.find((event) => event.id === selectedEventId) ?? defaultEvent;
  const selectedAgendaEvent = selectedEventId
    ? (libraryEvents.find((event) => event.id === selectedEventId) ?? null)
    : null;
  const displayedAgendaTalks = React.useMemo(
    () =>
      agendaTalks.map((talk) =>
        formatAgendaTalkForTimeZone(talk, agendaTimeZoneMode),
      ),
    [agendaTalks, agendaTimeZoneMode],
  );
  const agendaDayLabels = Array.from(
    new Set(displayedAgendaTalks.map((talk) => talk.dayLabel)),
  );
  const selectedAgendaDay = agendaDayLabels.includes(agendaDayLabel ?? '')
    ? agendaDayLabel
    : (agendaDayLabels[0] ?? null);
  const visibleAgendaTalks = displayedAgendaTalks.filter((talk) => {
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
  const bookmarkedAgendaTalks = displayedAgendaTalks.filter(
    (talk) => talk.bookmarked,
  );
  const annotatedAgendaTalks = displayedAgendaTalks.filter(
    (talk) => talk.annotatedSlideCount > 0,
  );
  const normalizedAgendaSearchQuery = agendaSearchQuery.trim().toLowerCase();
  const searchAgendaTalks = displayedAgendaTalks.filter((talk) =>
    talkMatchesSearchQuery(talk, normalizedAgendaSearchQuery),
  );
  const selectedAgendaTalk =
    visibleAgendaTalks.find((talk) => talk.id === selectedAgendaTalkId) ??
    visibleAgendaTalks[0] ??
    null;
  const agendaMaterialsTalk =
    visibleAgendaTalks.find((talk) => talk.id === agendaMaterialsTalkId) ??
    null;
  const selectedAgendaDayIndex = selectedAgendaDay
    ? agendaDayLabels.indexOf(selectedAgendaDay)
    : -1;
  const canMoveToPreviousDay = selectedAgendaDayIndex > 0;
  const canMoveToNextDay =
    selectedAgendaDayIndex >= 0 &&
    selectedAgendaDayIndex < agendaDayLabels.length - 1;
  const eventUrlError = eventUrlTouched ? validateEventUrl(eventUrl) : null;
  const selectedTalkDeck = selectedAgendaTalk
    ? getSelectedTalkDeck(selectedAgendaTalk)
    : null;
  const agendaMaterialsPdfMaterials = agendaMaterialsTalk
    ? getAgendaTalkPdfMaterials(agendaMaterialsTalk)
    : [];
  const agendaMaterialsNonPdfMaterials = agendaMaterialsTalk
    ? agendaMaterialsTalk.materials.filter(
        (material) => material.mimeType !== 'application/pdf',
      )
    : [];
  const agendaEventTimeZone = agendaTalks[0]?.eventTimeZone ?? null;
  const agendaLocalTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
  const agendaMaterialsDeck = agendaMaterialsTalk
    ? getSelectedTalkDeck(agendaMaterialsTalk)
    : null;
  const openAgendaTalkSlides = async (
    talk: AgendaTalkSummary,
    deckId?: string,
  ) => {
    captureAgendaScrollPosition();
    setViewerMode('slides');

    const selectedPdfMaterial =
      talk.materials.find(
        (material) =>
          material.mimeType === 'application/pdf' &&
          (deckId ? material.id === deckId : material.selected),
      ) ??
      talk.materials.find(
        (material) =>
          material.mimeType === 'application/pdf' &&
          (deckId ? material.id === deckId : true),
      ) ??
      null;

    if (!selectedPdfMaterial) {
      return;
    }

    const openResult = await window.indicoInk.openTalkDeck(
      talk.conferenceId,
      talk.id,
      selectedPdfMaterial.id,
    );

    setSelectedEventId(talk.conferenceId);
    setAgendaDayLabel(talk.dayLabel);
    setSelectedAgendaTalkId(talk.id);
    setDestination('slides');

    if (openResult.kind === 'ready') {
      setSlideViewerState({
        kind: 'ready',
        conferenceId: talk.conferenceId,
        talkId: talk.id,
        deckId: selectedPdfMaterial.id,
        filePath: openResult.filePath,
        title: talk.title,
        selectedMaterialId: selectedPdfMaterial.id,
        materials: talk.materials,
        downloadStatus: null,
      });
      return;
    }

    if (openResult.kind === 'downloading') {
      setSlideViewerState({
        kind: 'loading',
        conferenceId: talk.conferenceId,
        talkId: talk.id,
        deckId: selectedPdfMaterial.id,
        filePath: openResult.filePath,
        title: talk.title,
        selectedMaterialId: selectedPdfMaterial.id,
        materials: talk.materials,
        downloadStatus: {
          operationId: openResult.operationId,
          conferenceId: openResult.conferenceId,
          talkId: openResult.talkId,
          deckId: openResult.deckId,
          sourceUrl: openResult.sourceUrl,
          displayName: openResult.displayName,
          filePath: openResult.filePath,
          startedAt: Date.now(),
          kind: 'queued',
          bytesDownloaded: 0,
          totalBytes: null,
          message: 'Preparing download...',
          updatedAt: Date.now(),
        },
      });
      return;
    }

    if (openResult.kind === 'api-key-required') {
      setSlideViewerState({
        kind: 'error',
        conferenceId: talk.conferenceId,
        talkId: talk.id,
        deckId: selectedPdfMaterial.id,
        filePath: null,
        title: talk.title,
        selectedMaterialId: selectedPdfMaterial.id,
        materials: talk.materials,
        downloadStatus: null,
        message: openResult.message,
      });
      setApiKeyDialogRequest({
        kind: 'deck',
        origin: openResult.origin,
        message: openResult.message,
        conferenceId: talk.conferenceId,
        talkId: talk.id,
        deckId: selectedPdfMaterial.id,
      });
      setApiKeyValue('');
      setApiKeyError(openResult.message);
      return;
    }

    setSlideViewerState({
      kind: 'error',
      conferenceId: talk.conferenceId,
      talkId: talk.id,
      deckId: selectedPdfMaterial.id,
      filePath: null,
      title: talk.title,
      selectedMaterialId: selectedPdfMaterial.id,
      materials: talk.materials,
      downloadStatus: null,
      message: openResult.message,
    });
  };
  const openAgendaTalkNotes = async (talk: AgendaTalkSummary) => {
    captureAgendaScrollPosition();
    const notebookDeck = await window.indicoInk.ensureNotebookDeck(talk.id);
    setNotesDeckId(notebookDeck.id);
    setSelectedEventId(talk.conferenceId);
    setAgendaDayLabel(talk.dayLabel);
    setSelectedAgendaTalkId(talk.id);
    setViewerMode('notes');
    setDestination('slides');
  };
  const handleViewerModeChange = (mode: ViewerMode) => {
    if (mode === 'notes' && selectedAgendaTalk) {
      void openAgendaTalkNotes(selectedAgendaTalk);
      return;
    }
    setViewerMode(mode);
  };
  const openAgendaTalkFromIndex = (talk: AgendaTalkSummary) => {
    setSelectedEventId(talk.conferenceId);
    setAgendaDayLabel(talk.dayLabel);
    setSelectedAgendaTalkId(talk.id);
    setDestination('agenda');
  };
  const handleSelectTalkDeck = async (
    talk: AgendaTalkSummary,
    deckId: string,
  ) => {
    await window.indicoInk.setSelectedDeck(talk.id, deckId);
    setAgendaTalks((currentTalks) =>
      currentTalks.map((currentTalk) =>
        currentTalk.id === talk.id
          ? {
              ...currentTalk,
              materials: currentTalk.materials.map((material) => ({
                ...material,
                selected: material.id === deckId,
              })),
            }
          : currentTalk,
      ),
    );
    if (selectedAgendaTalk?.id === talk.id) {
      setSelectedAgendaTalkId(talk.id);
    }
  };
  const openSearchResult = (talk: AgendaTalkSummary) => {
    openAgendaTalkFromIndex(talk);
  };
  const openIndicoEventInApp = React.useCallback(
    async (eventUrl: string) => {
      const openedEvent = await window.indicoInk.openLibraryEvent(eventUrl);
      if (openedEvent.kind === 'api-key-required') {
        setApiKeyDialogRequest({
          kind: 'event',
          origin: openedEvent.origin,
          message: openedEvent.message,
          eventUrl,
        });
        setApiKeyValue('');
        setApiKeyError(openedEvent.message);
        setOpenEventFeedback({
          tone: 'warning',
          message: openedEvent.message,
        });
        return;
      }

      if (openedEvent.kind === 'llm-configuration-required') {
        setOpenEventFeedback({
          tone: 'warning',
          message: openedEvent.message,
        });
        await showOpenAiConfigurationDialog({
          operation: 'event',
          reason: openedEvent.reason,
          message: openedEvent.message,
          eventUrl,
        });
        return;
      }

      await refreshLibraryEvents();
      setSelectedEventId(openedEvent.result.conferenceId);
      setDestination('agenda');
      setApiKeyDialogRequest(null);
      setApiKeyValue('');
      setApiKeyError(null);
      setOpenEventFeedback({
        tone: 'success',
        message: `Opened ${openedEvent.result.title} with ${openedEvent.result.talkCount} talks.`,
      });
    },
    [refreshLibraryEvents, showOpenAiConfigurationDialog],
  );

  React.useEffect(() => {
    let cancelled = false;
    const openLaunchEvent = async (launchUrl: string) => {
      if (cancelled) {
        return;
      }

      setEventUrl(launchUrl);
      setEventUrlTouched(true);
      setIsOpeningEvent(true);
      setOpenEventFeedback({
        tone: 'neutral',
        message: 'Opening event from the launch request...',
      });

      try {
        await openIndicoEventInApp(launchUrl);
      } catch (error) {
        if (!cancelled) {
          setOpenEventFeedback({
            tone: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Failed to open the launch event.',
          });
        }
      } finally {
        if (!cancelled) {
          setIsOpeningEvent(false);
        }
      }
    };

    const unsubscribe = window.indicoInk.onIndicoEventUrlRequested(
      (launchUrl) => void openLaunchEvent(launchUrl),
    );
    void window.indicoInk.getStartupIndicoEventUrl().then((launchUrl) => {
      if (launchUrl) {
        void openLaunchEvent(launchUrl);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [openIndicoEventInApp]);
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
      message: 'Fetching the event source and saving the agenda locally...',
    });

    try {
      await openIndicoEventInApp(eventUrl);
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
    const request = apiKeyDialogRequest;
    if (!request) {
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
      await window.indicoInk.saveIndicoApiKey(request.origin, trimmedApiKey);
      await refreshIndicoApiKeys();

      if (request.kind === 'event') {
        const reopenedEvent = await window.indicoInk.openLibraryEvent(
          request.eventUrl,
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
        if (reopenedEvent.kind === 'llm-configuration-required') {
          setApiKeyError(reopenedEvent.message);
          return;
        }

        await refreshLibraryEvents();
        setSelectedEventId(reopenedEvent.result.conferenceId);
        setDestination('agenda');
        setApiKeyDialogRequest(null);
        setApiKeyValue('');
        setOpenEventFeedback({
          tone: 'success',
          message: `Opened ${reopenedEvent.result.title} with ${reopenedEvent.result.talkCount} talks.`,
        });
        return;
      }

      if (request.kind === 'refresh') {
        const refreshedEvent = await window.indicoInk.refreshLibraryEvent(
          request.eventUrl,
          request.decision,
        );
        if (refreshedEvent.kind === 'api-key-required') {
          agendaRefreshCompletionMessageRef.current = null;
          setApiKeyError(refreshedEvent.message);
          setRefreshState({ kind: 'error', message: refreshedEvent.message });
          return;
        }
        if (refreshedEvent.kind === 'llm-configuration-required') {
          setApiKeyDialogRequest(null);
          setApiKeyValue('');
          await showOpenAiConfigurationDialog({
            operation: 'refresh',
            reason: refreshedEvent.reason,
            message: refreshedEvent.message,
            eventUrl: request.eventUrl,
            ...(request.decision ? { decision: request.decision } : {}),
          });
          return;
        }
        if (refreshedEvent.kind === 'conflict') {
          agendaRefreshCompletionMessageRef.current = null;
          setRefreshState({
            kind: 'conflict',
            message: 'The upstream PDF changed for an annotated deck.',
            conflicts: refreshedEvent.conflicts,
          });
        } else {
          await refreshLibraryEvents();
          setAgendaReloadVersion((version) => version + 1);
          const completionMessage = `Refreshed ${refreshedEvent.title}: ${refreshedEvent.changedTalkCount} changed, ${refreshedEvent.removedTalkCount} removed, ${refreshedEvent.newlyAvailableDeckCount} new PDF${refreshedEvent.newlyAvailableDeckCount === 1 ? '' : 's'}.`;
          if (destination === 'agenda') {
            agendaRefreshCompletionMessageRef.current = completionMessage;
            setRefreshState({
              kind: 'refreshing',
              message: 'Updating the agenda…',
            });
          } else {
            setRefreshState({ kind: 'done', message: completionMessage });
          }
        }
        setApiKeyDialogRequest(null);
        setApiKeyValue('');
        setApiKeyError(null);
        return;
      }

      const talk = agendaTalks.find(
        (candidate) => candidate.id === request.talkId,
      );
      if (!talk) {
        setApiKeyError('The selected talk is no longer available.');
        return;
      }

      const deckId = request.deckId;
      setApiKeyDialogRequest(null);
      setApiKeyValue('');
      await openAgendaTalkSlides(talk, deckId);
    } catch (error) {
      setApiKeyError(
        error instanceof Error ? error.message : 'Failed to save the API key.',
      );
    } finally {
      setIsSavingApiKey(false);
    }
  };
  const handleSaveOpenAiConfiguration = async () => {
    const request = openAiDialogRequest;
    if (!request || isSavingOpenAi) {
      return;
    }
    if (!openAiBaseUrl.trim() || !openAiModel.trim() || !openAiApiKey.trim()) {
      setOpenAiError('Endpoint, model, and API key are required.');
      return;
    }

    setIsSavingOpenAi(true);
    setOpenAiError(null);
    try {
      const configuration = await window.indicoInk.saveOpenAiConfiguration({
        baseUrl: openAiBaseUrl.trim(),
        model: openAiModel.trim(),
        reasoningEffort: openAiReasoningEffort,
        apiKey: openAiApiKey.trim(),
      });
      setOpenAiConfiguration(configuration);
      setAppSettings(await window.indicoInk.getAppSettings());

      if (request.operation === 'settings' || !request.eventUrl) {
        setOpenAiDialogRequest(null);
        setOpenAiApiKey('');
        return;
      }

      if (request.operation === 'event') {
        const reopenedEvent = await window.indicoInk.openLibraryEvent(
          request.eventUrl,
        );
        if (reopenedEvent.kind !== 'opened') {
          setOpenAiError(reopenedEvent.message);
          return;
        }
        await refreshLibraryEvents();
        setSelectedEventId(reopenedEvent.result.conferenceId);
        setDestination('agenda');
        setOpenEventFeedback({
          tone: 'success',
          message: `Opened ${reopenedEvent.result.title} with ${reopenedEvent.result.talkCount} talks.`,
        });
      } else {
        const refreshedEvent = await window.indicoInk.refreshLibraryEvent(
          request.eventUrl,
          request.decision,
        );
        if (refreshedEvent.kind === 'llm-configuration-required') {
          setOpenAiError(refreshedEvent.message);
          return;
        }
        if (refreshedEvent.kind === 'api-key-required') {
          setOpenAiError(refreshedEvent.message);
          return;
        }
        if (refreshedEvent.kind === 'conflict') {
          setRefreshState({
            kind: 'conflict',
            message: 'The upstream PDF changed for an annotated deck.',
            conflicts: refreshedEvent.conflicts,
          });
        } else {
          await refreshLibraryEvents();
          setAgendaReloadVersion((version) => version + 1);
          setRefreshState({
            kind: 'done',
            message: `Refreshed ${refreshedEvent.title}: ${refreshedEvent.changedTalkCount} changed, ${refreshedEvent.removedTalkCount} removed, ${refreshedEvent.newlyAvailableDeckCount} new PDF${refreshedEvent.newlyAvailableDeckCount === 1 ? '' : 's'}.`,
          });
        }
      }

      setOpenAiDialogRequest(null);
      setOpenAiApiKey('');
      setOpenAiError(null);
    } catch (error) {
      setOpenAiError(
        error instanceof Error
          ? error.message
          : 'Failed to save the OpenAI configuration.',
      );
    } finally {
      setIsSavingOpenAi(false);
    }
  };
  const handleOpenSelectedTalkDeck = async () => {
    if (!selectedAgendaTalk) {
      return;
    }

    setAgendaMaterialsTalkId(null);
    await openAgendaTalkSlides(selectedAgendaTalk);
  };
  const handleOpenTalkMaterials = (talk: AgendaTalkSummary) => {
    setSelectedAgendaTalkId(talk.id);
    setSelectedEventId(talk.conferenceId);
    setAgendaDayLabel(talk.dayLabel);
    setAgendaMaterialsTalkId(talk.id);
  };
  const handleOpenContributionLink = async (url: string | null) => {
    if (!url) {
      return;
    }

    await window.indicoInk.openExternalUrl(url);
  };
  const resolveLinkedAgendaTarget = async (talk: AgendaTalkSummary) => {
    const linkedAgendaUrl = talk.linkedAgendaUrl ?? '';
    const isCachedSessionUrl =
      Boolean(linkedAgendaUrl) &&
      parseIndicoEventSessionUrl(talk.contributionUrl) !== null &&
      linkedAgendaUrl.replace(/\/+$/, '') ===
        talk.contributionUrl.replace(/\/+$/, '');

    if (!isCachedSessionUrl) {
      return linkedAgendaUrl;
    }

    const resolvedLinkedAgendaUrl =
      await window.indicoInk.resolveLinkedAgendaUrl(talk.contributionUrl);
    if (!resolvedLinkedAgendaUrl) {
      return '';
    }

    setAgendaTalks((currentTalks) =>
      currentTalks.map((currentTalk) =>
        currentTalk.id === talk.id
          ? { ...currentTalk, linkedAgendaUrl: resolvedLinkedAgendaUrl }
          : currentTalk,
      ),
    );
    return resolvedLinkedAgendaUrl;
  };
  const handleOpenLinkedAgenda = async (talk: AgendaTalkSummary) => {
    const linkedAgendaUrl = await resolveLinkedAgendaTarget(talk);
    if (!linkedAgendaUrl) {
      return;
    }

    await window.indicoInk.openExternalUrl(linkedAgendaUrl);
  };
  const handleCopyLinkedAgenda = async (
    talk: AgendaTalkSummary,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    const linkedAgendaUrl = await resolveLinkedAgendaTarget(talk);
    await handleCopyLink(
      linkedAgendaUrl || null,
      event,
      'Copied linked agenda URL',
    );
  };
  const handleOpenLinkedAgendaInApp = async (talk: AgendaTalkSummary) => {
    setIsOpeningEvent(true);

    try {
      let linkedAgendaUrl = await resolveLinkedAgendaTarget(talk);
      let identity = linkedAgendaUrl
        ? parseIndicoEventLinkUrl(linkedAgendaUrl)
        : null;

      if (!identity && parseIndicoEventSessionUrl(talk.contributionUrl)) {
        setOpenEventFeedback({
          tone: 'neutral',
          message: 'Finding the linked agenda in Indico…',
        });
        const resolvedLinkedAgendaUrl =
          await window.indicoInk.resolveLinkedAgendaUrl(talk.contributionUrl);
        linkedAgendaUrl = resolvedLinkedAgendaUrl ?? '';
        identity = linkedAgendaUrl
          ? parseIndicoEventLinkUrl(linkedAgendaUrl)
          : null;

        if (linkedAgendaUrl) {
          setAgendaTalks((currentTalks) =>
            currentTalks.map((currentTalk) =>
              currentTalk.id === talk.id
                ? { ...currentTalk, linkedAgendaUrl }
                : currentTalk,
            ),
          );
        }
      }

      if (!identity) {
        setOpenEventFeedback({
          tone: 'error',
          message: 'No linked Indico agenda URL is available for this entry.',
        });
        return;
      }

      setOpenEventFeedback({
        tone: 'neutral',
        message: 'Opening linked agenda in IndicoInk…',
      });
      await openIndicoEventInApp(identity.canonicalEventUrl);
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
  const handleOpenSelectedPdfLink = async () => {
    const sourceUrl = activeSlideSelectedMaterial?.sourceUrl ?? null;
    if (!sourceUrl) {
      return;
    }

    await window.indicoInk.openExternalUrl(sourceUrl);
  };
  const showCopyTooltip = React.useCallback(
    (message: string, clientX: number, clientY: number) => {
      if (copyTooltipTimerRef.current !== null) {
        window.clearTimeout(copyTooltipTimerRef.current);
        copyTooltipTimerRef.current = null;
      }

      setCopyTooltip({
        message,
        x: clientX + 16,
        y: clientY + 18,
      });
      copyTooltipTimerRef.current = window.setTimeout(() => {
        setCopyTooltip(null);
        copyTooltipTimerRef.current = null;
      }, 2500);
    },
    [],
  );
  const handleCopyLink = async (
    url: string | null,
    event: React.MouseEvent<HTMLButtonElement>,
    message: string,
  ) => {
    if (!url) {
      return;
    }

    showCopyTooltip(message, event.clientX, event.clientY);
    await copyTextToClipboard(url);
  };
  const handleSelectSelectedTalkDeck = async (deckId: string) => {
    if (!selectedAgendaTalk) {
      return;
    }

    await handleSelectTalkDeck(selectedAgendaTalk, deckId);
    if (destination === 'slides') {
      await openAgendaTalkSlides(selectedAgendaTalk, deckId);
    }
  };
  const handleCancelDeckDownload = async () => {
    const operationId = activeSlideDownloadStatus?.operationId;
    if (!operationId) {
      return;
    }

    await window.indicoInk.cancelDeckDownload(operationId);
    setDestination('agenda');
  };
  const handleRetryDeckDownload = async () => {
    if (
      slideViewerState.kind !== 'error' ||
      !selectedAgendaTalk ||
      !selectedTalkDeck
    ) {
      return;
    }

    await openAgendaTalkSlides(selectedAgendaTalk);
  };
  const handleRetryPdfLoad = () => {
    if (!selectedAgendaTalk || !activeSlideSelectedMaterialId) {
      return;
    }

    void openAgendaTalkSlides(
      selectedAgendaTalk,
      activeSlideSelectedMaterialId,
    );
  };
  const handleCancelExport = () => {
    if (exportCancellationRef.current) {
      exportCancellationRef.current.cancelled = true;
    }
  };
  const handleRefreshAction = async () => {
    if (refreshState.kind === 'conflict') {
      return;
    }

    await refreshSelectedEvent();
  };
  const handleResolveRefreshConflict = async (decision: 'keep' | 'replace') => {
    await refreshSelectedEvent(decision);
  };
  const handleExportNotes = async () => {
    if (!selectedEventId) {
      setExportState({
        kind: 'error',
        label: 'Open an event before exporting notes.',
      });
      return;
    }

    const cancellationState = { cancelled: false };
    exportCancellationRef.current = cancellationState;

    try {
      const snapshot = await window.indicoInk.getConferenceExportSnapshot(
        selectedEventId,
        destination === 'slides' ? activeSlideTalkId : null,
      );
      if (cancellationState.cancelled) {
        setExportState({
          kind: 'canceled',
          label: 'Export canceled before rendering.',
        });
        return;
      }

      const renderJobs = snapshot ? collectExportRenderJobs(snapshot) : [];
      const noteJobs = snapshot
        ? snapshot.talks.flatMap((talk) =>
            (talk.notes ?? []).map((note) => ({
              talkId: talk.id,
              talkTitle: talk.title,
              pageNumber: note.pageNumber,
              referenceSlideNumber: note.referenceSlideNumber,
              annotations: note.annotations,
            })),
          )
        : [];
      const totalRenderJobs = renderJobs.length + noteJobs.length;

      if (!snapshot || snapshot.talks.length === 0) {
        setExportState({
          kind: 'empty',
          label: 'No annotated slides or note pages are available to export.',
        });
        return;
      }

      const saveResult = await window.indicoInk.showExportSaveDialog({
        title: `Export notes for ${snapshot.conference.title}`,
        defaultPath: createExportFileName(
          snapshot.conference,
          destination === 'slides' && activeSlideTalkId
            ? snapshot.talks[0]?.title
            : null,
        ),
      });

      if (cancellationState.cancelled) {
        setExportState({
          kind: 'canceled',
          label: 'Export canceled before saving.',
        });
        return;
      }

      if (saveResult.canceled || !saveResult.filePath) {
        setExportState({ kind: 'idle' });
        return;
      }

      if (snapshot.restoredDecks?.length) {
        const restored = snapshot.restoredDecks[0]!;
        setExportState({
          kind: 'preparing',
          label: `Restored ${restored.deckDisplayName} for ${restored.talkTitle}. Preparing export...`,
        });
      } else {
        setExportState({
          kind: 'preparing',
          label: 'Preparing export and restoring missing PDF decks...',
        });
      }

      const renderedSlides: ExportRenderedSlide[] = [];
      const renderedNotePages: ExportRenderedNotePage[] = [];
      setExportState({
        kind: 'rendering',
        label: `Rendering ${totalRenderJobs} annotated page${totalRenderJobs === 1 ? '' : 's'}...`,
        completed: 0,
        total: totalRenderJobs,
      });

      for (let index = 0; index < renderJobs.length; index += 1) {
        const job = renderJobs[index];
        if (!job) {
          continue;
        }

        if (cancellationState.cancelled) {
          setExportState({
            kind: 'canceled',
            label: 'Export canceled before the file was written.',
          });
          return;
        }

        const renderedSlide = await renderAnnotatedSlidePng({
          filePath: job.deckFilePath,
          slideNumber: job.slideNumber,
          annotations: job.annotations,
          readPdfBytes: (filePath) => window.indicoInk.readPdfBytes(filePath),
        });
        renderedSlides.push({
          talkId: job.talkId,
          contributionId: job.contributionId,
          contributionUrl: job.contributionUrl,
          talkTitle: job.talkTitle,
          sessionTitle: job.sessionTitle,
          deckId: job.deckId,
          deckDisplayName: job.deckDisplayName,
          deckSourceUrl: job.deckSourceUrl,
          slideNumber: job.slideNumber,
          imageDataUrl: renderedSlide.imageDataUrl,
          links: renderedSlide.links,
        });
        setExportState({
          kind: 'rendering',
          label: `Rendering ${index + 1} of ${totalRenderJobs} annotated pages...`,
          completed: index + 1,
          total: totalRenderJobs,
        });
      }

      for (let index = 0; index < noteJobs.length; index += 1) {
        const job = noteJobs[index];
        if (!job) {
          continue;
        }
        if (cancellationState.cancelled) {
          setExportState({
            kind: 'canceled',
            label: 'Export canceled before the file was written.',
          });
          return;
        }

        const renderedNote = await renderAnnotatedNotePagePng({
          annotations: job.annotations,
        });
        renderedNotePages.push({
          talkId: job.talkId,
          talkTitle: job.talkTitle,
          pageNumber: job.pageNumber,
          referenceSlideNumber: job.referenceSlideNumber,
          imageDataUrl: renderedNote.imageDataUrl,
        });
        setExportState({
          kind: 'rendering',
          label: `Rendering ${renderJobs.length + index + 1} of ${totalRenderJobs} annotated pages...`,
          completed: renderJobs.length + index + 1,
          total: totalRenderJobs,
        });
      }

      const markdown = buildConferenceNotesMarkdown(
        snapshot,
        renderedSlides,
        renderedNotePages,
      );
      setExportState({
        kind: 'writing',
        label: 'Writing Markdown export...',
        completed: totalRenderJobs,
        total: totalRenderJobs,
      });
      await window.indicoInk.writeExportFile(saveResult.filePath, markdown);

      if (cancellationState.cancelled) {
        setExportState({
          kind: 'canceled',
          label: 'Export canceled after rendering completed.',
        });
        return;
      }

      await window.indicoInk.openExportFileLocation(saveResult.filePath);
      setExportState({
        kind: 'done',
        label: `Exported notes to ${saveResult.filePath}`,
        filePath: saveResult.filePath,
      });
    } catch (error) {
      setExportState({
        kind: 'error',
        label:
          error instanceof Error ? error.message : 'Failed to export notes.',
      });
    } finally {
      if (exportCancellationRef.current === cancellationState) {
        exportCancellationRef.current = null;
      }
    }
  };
  const openLibraryEvent = (event: EventSummary) => {
    setSelectedEventId(event.id);
    setDestination('agenda');
  };
  const toggleAgendaTalkBookmark = async (
    talkId: string,
    bookmarked: boolean,
  ) => {
    await window.indicoInk.setTalkBookmarked(talkId, bookmarked);
    setAgendaTalks((currentTalks) =>
      currentTalks.map((talk) =>
        talk.id === talkId ? { ...talk, bookmarked } : talk,
      ),
    );
  };
  const handleAgendaTalkBookmarkToggle = async (talk: AgendaTalkSummary) => {
    await toggleAgendaTalkBookmark(talk.id, !talk.bookmarked);
  };
  const requestDeleteLibraryEvent = (event: EventSummary) => {
    setDeleteTarget(event);
  };
  const requestDeleteIndicoApiKey = (apiKey: IndicoApiKeySummary) => {
    setApiKeyDeleteTarget(apiKey);
  };
  const confirmDeleteLibraryEvent = async () => {
    if (!deleteTarget) {
      return;
    }

    const deletingSelected = selectedEventId === deleteTarget.id;
    await window.indicoInk.deleteLibraryEvent(deleteTarget.id);
    setDeleteTarget(null);

    if (deletingSelected) {
      setSelectedEventId(null);
      await returnToLibrary();
      return;
    }

    await refreshLibraryEvents();
  };
  const confirmDeleteIndicoApiKey = async () => {
    if (!apiKeyDeleteTarget) {
      return;
    }

    await window.indicoInk.deleteIndicoApiKey(apiKeyDeleteTarget.origin);
    setApiKeyDeleteTarget(null);
    await refreshIndicoApiKeys();
  };
  const deleteOpenAiApiKey = async () => {
    await window.indicoInk.deleteOpenAiApiKey();
    await refreshOpenAiConfiguration();
  };

  React.useEffect(() => {
    if (slideViewerState.kind !== 'loading') {
      if (deckDownloadPollRef.current !== null) {
        window.clearInterval(deckDownloadPollRef.current);
        deckDownloadPollRef.current = null;
      }
      return undefined;
    }

    const operationId = activeSlideDownloadStatus?.operationId ?? null;
    if (!operationId) {
      return undefined;
    }

    const poll = async () => {
      const status = await window.indicoInk.getDeckDownloadStatus(operationId);
      if (!status) {
        return;
      }

      setSlideViewerState((currentState) => {
        if (currentState.kind !== 'loading') {
          return currentState;
        }

        const nextStatus = status;
        if (nextStatus.kind === 'ready') {
          return {
            kind: 'ready',
            conferenceId: currentState.conferenceId,
            talkId: currentState.talkId,
            deckId: currentState.deckId,
            filePath: currentState.filePath ?? nextStatus.filePath,
            title: currentState.title,
            selectedMaterialId: currentState.selectedMaterialId,
            materials: currentState.materials,
            downloadStatus: nextStatus,
          };
        }

        if (nextStatus.kind === 'error' || nextStatus.kind === 'canceled') {
          return {
            kind: 'error',
            conferenceId: currentState.conferenceId,
            talkId: currentState.talkId,
            deckId: currentState.deckId,
            filePath: currentState.filePath,
            title: currentState.title,
            selectedMaterialId: currentState.selectedMaterialId,
            materials: currentState.materials,
            downloadStatus: nextStatus,
            message: nextStatus.message ?? 'Download failed.',
          };
        }

        return {
          ...currentState,
          downloadStatus: nextStatus,
        };
      });
    };

    void poll();
    deckDownloadPollRef.current = window.setInterval(() => {
      void poll();
    }, 500);

    return () => {
      if (deckDownloadPollRef.current !== null) {
        window.clearInterval(deckDownloadPollRef.current);
        deckDownloadPollRef.current = null;
      }
    };
  }, [activeSlideDownloadStatus, slideViewerState.kind]);

  React.useEffect(() => {
    const operationId = agendaDownloadStatus?.operationId;
    if (
      !operationId ||
      agendaDownloadStatus?.kind === 'ready' ||
      agendaDownloadStatus?.kind === 'error' ||
      agendaDownloadStatus?.kind === 'canceled'
    ) {
      if (agendaDownloadPollRef.current !== null) {
        window.clearInterval(agendaDownloadPollRef.current);
        agendaDownloadPollRef.current = null;
      }
      return undefined;
    }

    const poll = async () => {
      const status =
        await window.indicoInk.getAgendaDownloadStatus(operationId);
      if (status) {
        setAgendaDownloadStatus(status);
      }
    };

    void poll();
    agendaDownloadPollRef.current = window.setInterval(() => {
      void poll();
    }, 500);

    return () => {
      if (agendaDownloadPollRef.current !== null) {
        window.clearInterval(agendaDownloadPollRef.current);
        agendaDownloadPollRef.current = null;
      }
    };
  }, [agendaDownloadStatus?.operationId, agendaDownloadStatus?.kind]);

  React.useEffect(() => {
    let canceled = false;

    if (!selectedEventId || destination !== 'agenda') {
      setAgendaDownloadSummary(null);
      return () => {
        canceled = true;
      };
    }

    void window.indicoInk
      .getAgendaDownloadSummary(selectedEventId)
      .then((summary) => {
        if (!canceled) {
          setAgendaDownloadSummary(summary);
        }
      })
      .catch(() => {
        if (!canceled) {
          setAgendaDownloadSummary(null);
        }
      });

    return () => {
      canceled = true;
    };
  }, [agendaReloadVersion, destination, selectedEventId]);

  React.useEffect(() => {
    setAgendaTimeZoneMode('event');
  }, [selectedEventId]);

  React.useEffect(() => {
    if (slideViewerState.kind === 'closed') {
      setSlideViewerMetrics({
        currentSlideNumber: 1,
        currentPageCount: 0,
      });
    }
  }, [slideViewerState.kind]);

  React.useEffect(() => {
    let cancelled = false;

    if (!selectedEventId) {
      agendaTalksLoadedEventIdRef.current = null;
      setAgendaTalks([]);
      setAgendaTalksLoading(false);
      setAgendaTalksError(null);
      setAgendaDayLabel(null);
      setSelectedAgendaTalkId(null);
      return () => {
        cancelled = true;
      };
    }

    if (destination !== 'agenda') {
      return () => {
        cancelled = true;
      };
    }

    const isInitialAgendaLoad =
      agendaTalksLoadedEventIdRef.current !== selectedEventId;
    if (isInitialAgendaLoad) {
      setAgendaTalksLoading(true);
    }
    setAgendaTalksError(null);

    void window.indicoInk
      .listAgendaTalks(selectedEventId)
      .then((talks) => {
        if (!cancelled) {
          agendaTalksLoadedEventIdRef.current = selectedEventId;
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
          if (agendaRefreshCompletionMessageRef.current) {
            agendaRefreshCompletionMessageRef.current = null;
            setRefreshState({
              kind: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'Failed to update the agenda.',
            });
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAgendaTalksLoading(false);
          const completionMessage = agendaRefreshCompletionMessageRef.current;
          if (completionMessage) {
            agendaRefreshCompletionMessageRef.current = null;
            setRefreshState({ kind: 'done', message: completionMessage });
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agendaReloadVersion, destination, selectedEventId]);

  React.useEffect(() => {
    if (!displayedAgendaTalks.length) {
      setAgendaDayLabel(null);
      setSelectedAgendaTalkId(null);
      return;
    }

    setAgendaDayLabel((current) => {
      if (
        current &&
        displayedAgendaTalks.some((talk) => talk.dayLabel === current)
      ) {
        return current;
      }

      return displayedAgendaTalks[0]?.dayLabel ?? null;
    });
  }, [displayedAgendaTalks]);

  React.useEffect(() => {
    if (!visibleAgendaTalks.length) {
      if (selectedAgendaTalkId !== null) {
        setSelectedAgendaTalkId(null);
      }

      return;
    }

    if (
      selectedAgendaTalkId &&
      visibleAgendaTalks.some((talk) => talk.id === selectedAgendaTalkId)
    ) {
      return;
    }

    setSelectedAgendaTalkId(visibleAgendaTalks[0]?.id ?? null);
  }, [selectedAgendaTalkId, visibleAgendaTalks]);

  React.useEffect(() => {
    if (agendaMaterialsTalkId === null) {
      return;
    }

    if (agendaMaterialsTalk?.id !== agendaMaterialsTalkId) {
      setAgendaMaterialsTalkId(null);
    }
  }, [agendaMaterialsTalk?.id, agendaMaterialsTalkId]);

  const handleAgendaScroll = React.useCallback(() => {
    if (destination !== 'agenda' || !selectedEventId) {
      return;
    }

    const scrollContainer = pageSurfaceRef.current;
    if (!scrollContainer) {
      return;
    }

    agendaScrollPositionsRef.current.set(
      `${selectedEventId}::${selectedAgendaDay ?? ''}`,
      {
        scrollLeft: scrollContainer.scrollLeft,
        scrollTop: scrollContainer.scrollTop,
      },
    );
  }, [destination, selectedAgendaDay, selectedEventId]);

  const captureAgendaScrollPosition = React.useCallback(() => {
    if (!selectedEventId) {
      return;
    }

    const scrollContainer = pageSurfaceRef.current;
    if (!scrollContainer) {
      return;
    }

    agendaScrollPositionsRef.current.set(
      `${selectedEventId}::${selectedAgendaDay ?? ''}`,
      {
        scrollLeft: scrollContainer.scrollLeft,
        scrollTop: scrollContainer.scrollTop,
      },
    );
  }, [selectedAgendaDay, selectedEventId]);

  const restoreAgendaScrollPosition = React.useCallback(() => {
    if (!selectedEventId) {
      return;
    }

    const restoredScroll = agendaScrollPositionsRef.current.get(
      `${selectedEventId}::${selectedAgendaDay ?? ''}`,
    );

    if (!restoredScroll) {
      return;
    }

    const scheduleScrollRestoration =
      window.requestAnimationFrame ??
      ((callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(window.performance.now()), 0));
    const cancelScrollRestoration =
      window.cancelAnimationFrame ?? window.clearTimeout;

    if (agendaScrollFrameRef.current !== null) {
      cancelScrollRestoration(agendaScrollFrameRef.current);
    }

    const applyRestoredScroll = (remainingFrames: number) => {
      const scrollContainer = pageSurfaceRef.current;
      if (!scrollContainer) {
        agendaScrollFrameRef.current = null;
        return;
      }

      const maxScrollTop =
        scrollContainer.scrollHeight - scrollContainer.clientHeight;
      if (maxScrollTop < restoredScroll.scrollTop && remainingFrames > 0) {
        agendaScrollFrameRef.current = scheduleScrollRestoration(() => {
          applyRestoredScroll(remainingFrames - 1);
        });
        return;
      }

      if (typeof scrollContainer.scrollTo === 'function') {
        scrollContainer.scrollTo({
          left: restoredScroll.scrollLeft,
          top: restoredScroll.scrollTop,
          behavior: 'auto',
        });
      } else {
        scrollContainer.scrollLeft = restoredScroll.scrollLeft;
        scrollContainer.scrollTop = restoredScroll.scrollTop;
      }

      if (remainingFrames <= 0) {
        agendaScrollFrameRef.current = null;
        return;
      }

      agendaScrollFrameRef.current = scheduleScrollRestoration(() => {
        applyRestoredScroll(remainingFrames - 1);
      });
    };

    agendaScrollFrameRef.current = scheduleScrollRestoration(() => {
      applyRestoredScroll(120);
    });
  }, [selectedAgendaDay, selectedEventId]);

  React.useLayoutEffect(() => {
    if (destination !== 'agenda' || !selectedEventId) {
      return undefined;
    }

    const scrollContainer = pageSurfaceRef.current;
    if (!scrollContainer) {
      return undefined;
    }

    restoreAgendaScrollPosition();

    return () => {
      const cancelScrollRestoration =
        window.cancelAnimationFrame ?? window.clearTimeout;
      if (agendaScrollFrameRef.current !== null) {
        cancelScrollRestoration(agendaScrollFrameRef.current);
        agendaScrollFrameRef.current = null;
      }
    };
  }, [
    agendaReloadVersion,
    agendaTalks,
    destination,
    restoreAgendaScrollPosition,
    selectedEventId,
    selectedAgendaDay,
  ]);

  return (
    <div
      className={`app-frame${
        destination === 'agenda' ? ' is-compact-nav' : ''
      }${destination === 'slides' ? ' is-slides-view' : ''}`}
    >
      {destination === 'slides' ? null : (
        <aside className="nav-rail" aria-label="Primary navigation">
          <div className="nav-rail-brand" aria-label="IndicoInk">
            <div className="brand-mark">
              <picture>
                <source
                  media="(prefers-color-scheme: dark)"
                  srcSet={darkBrandIcon}
                />
                <img src={lightBrandIcon} alt="" />
              </picture>
            </div>
            <div className="brand-copy">
              <span className="brand-title">IndicoInk</span>
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
                title={
                  item.id === 'library'
                    ? 'Library (Alt+L)'
                    : item.id === 'search'
                      ? 'Search (Ctrl+F)'
                      : item.label
                }
                onClick={() => {
                  if (item.id === 'library') {
                    void returnToLibrary();
                    return;
                  }

                  setDestination(item.id);
                }}
              />
            ))}
          </nav>
        </aside>
      )}

      <section className="workspace">
        {destination === 'slides' ? null : (
          <CommandBar
            kicker={
              destination === 'agenda'
                ? ''
                : destination === 'library'
                  ? 'Library'
                  : destination === 'settings'
                    ? 'Settings'
                    : activeEvent.title
            }
            title={
              destination === 'agenda'
                ? activeEvent.title
                : destination === 'library'
                  ? 'Open an event'
                  : destination === 'search'
                    ? 'Search talks'
                    : destination === 'bookmarks'
                      ? 'Bookmarks'
                      : destination === 'annotated'
                        ? 'Annotated talks'
                        : 'Settings'
            }
            titleMeta={
              destination === 'agenda'
                ? formatAgendaDateRangeLabel(selectedAgendaEvent?.dates ?? '')
                : undefined
            }
            status={commandBarStatus}
            leading={
              destination === 'library' ? undefined : (
                <IconButton
                  label="Back to library"
                  icon="back"
                  title="Back to library (Alt+L)"
                  onClick={() => {
                    void returnToLibrary();
                  }}
                />
              )
            }
            actions={commandBarActions}
          />
        )}

        {agendaDownloadStatus && agendaDownloadBannerVisible ? (
          <div
            className="agenda-download-banner"
            role="status"
            aria-live="polite"
          >
            <div className="agenda-download-copy">
              <strong>
                {agendaDownloadStatus.kind === 'ready'
                  ? 'Talks available offline'
                  : agendaDownloadStatus.kind === 'error'
                    ? 'Talks download incomplete'
                    : agendaDownloadStatus.kind === 'canceled'
                      ? 'Talks download canceled'
                      : 'Downloading talks'}
              </strong>
              <span>
                {agendaDownloadStatus.message ?? 'Preparing talks download...'}
              </span>
            </div>
            <progress
              className="agenda-download-progress-bar"
              value={
                agendaDownloadStatus.totalDecks > 0
                  ? agendaDownloadStatus.completedDecks
                  : undefined
              }
              max={Math.max(agendaDownloadStatus.totalDecks, 1)}
            />
            <span className="agenda-download-count">
              {agendaDownloadStatus.totalDecks > 0
                ? `${agendaDownloadStatus.completedDecks}/${agendaDownloadStatus.totalDecks} PDFs`
                : 'Preparing'}
            </span>
            {agendaDownloadStatus.kind === 'queued' ||
            agendaDownloadStatus.kind === 'downloading' ? (
              <IconButton
                label="Cancel talks download"
                title="Cancel talks download"
                icon="trash"
                onClick={() => {
                  void cancelAgendaDownload();
                }}
              />
            ) : (
              <IconButton
                label="Dismiss talks download status"
                title="Dismiss"
                icon="check"
                onClick={() => {
                  setAgendaDownloadBannerVisible(false);
                }}
              />
            )}
          </div>
        ) : null}

        <main
          ref={pageSurfaceRef}
          className={`page-surface${destination === 'slides' ? ' is-slides-view' : ''}`}
          aria-live="polite"
          onScroll={destination === 'agenda' ? handleAgendaScroll : undefined}
        >
          {destination === 'library' && (
            <section className="page-stack">
              <div className="hero-panel">
                <div className="hero-copy">
                  <h2>Open an event</h2>
                  <p className="lede">
                    Paste an Indico event URL or another agenda webpage, or
                    reopen a recent event below.
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
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.currentTarget.focus();
                        event.currentTarget.select();
                      }}
                      onBlur={() => setEventUrlTouched(true)}
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      placeholder="https://example.org/event-or-agenda"
                      aria-invalid={eventUrlError ? 'true' : undefined}
                      aria-describedby={
                        eventUrlError
                          ? 'event-url-help event-url-error'
                          : 'event-url-help'
                      }
                    />
                  </label>
                  <div className="field-help" id="event-url-help">
                    <span>Use a full HTTPS event or agenda webpage URL.</span>
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
                </div>
                {libraryEvents.length ? (
                  <div className="event-list">
                    {libraryEvents.map((event) => (
                      <EventSummaryRow
                        key={event.id}
                        event={event}
                        selected={false}
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
                      Open an event to start building the local library.
                    </span>
                  </div>
                )}
              </section>
            </section>
          )}

          {destination === 'agenda' && (
            <section className="page-stack">
              {selectedAgendaEvent ? (
                <>
                  <div className="agenda-event-summary">
                    <div className="agenda-event-summary-actions">
                      <IconButton
                        label={`Open URL for ${selectedAgendaEvent.title}`}
                        title="Open URL"
                        icon="open"
                        onClick={() => {
                          void window.indicoInk.openExternalUrl(
                            selectedAgendaEvent.sourceUrl,
                          );
                        }}
                        disabled={!selectedAgendaEvent.sourceUrl}
                      />
                      <IconButton
                        label={`Copy URL for ${selectedAgendaEvent.title}`}
                        title="Copy URL"
                        icon="copy"
                        onClick={(event) => {
                          void handleCopyLink(
                            selectedAgendaEvent.sourceUrl,
                            event,
                            'Copied to clipboard',
                          );
                        }}
                        disabled={!selectedAgendaEvent.sourceUrl}
                      />
                    </div>
                    <StatusLabel
                      label={selectedAgendaEvent.host}
                      tone="neutral"
                      icon="info"
                    />
                    <StatusLabel
                      label={selectedAgendaEvent.cacheStatus}
                      tone="success"
                      icon="check"
                    />
                    {agendaDownloadSummary ? (
                      <StatusLabel
                        label={`${downloadedAgendaTalks} talk${downloadedAgendaTalks === 1 ? '' : 's'} downloaded`}
                        tone={
                          agendaDownloadStatus?.kind === 'error'
                            ? 'warning'
                            : 'success'
                        }
                        icon="download"
                      />
                    ) : null}
                    <StatusLabel
                      label={`${agendaTalks.length} ${
                        agendaTalks.length === 1 ? 'talk shown' : 'talks shown'
                      }`}
                      tone="neutral"
                      icon="agenda"
                    />
                    {selectedAgendaEvent.annotationSummary !==
                    '0 annotated slides' ? (
                      <StatusLabel
                        label={selectedAgendaEvent.annotationSummary}
                        tone="warning"
                        icon="annotated"
                      />
                    ) : null}
                  </div>
                  {openEventFeedback &&
                  (openEventFeedback.tone !== 'success' ||
                    destination !== 'agenda') ? (
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
                  {agendaTalksLoading ? (
                    <div className="empty-state agenda-empty-state">
                      <Icon name="agenda" />
                      <strong>Loading agenda talks</strong>
                      <span>
                        Stored talks are being read from the local event cache.
                      </span>
                    </div>
                  ) : agendaTalksError ? (
                    <div className="empty-state agenda-empty-state">
                      <Icon name="info" />
                      <strong>Agenda unavailable</strong>
                      <span>{agendaTalksError}</span>
                    </div>
                  ) : agendaTalks.length ? (
                    <div className="agenda-shell">
                      <div className="agenda-controls">
                        <div className="agenda-day-strip">
                          <IconButton
                            label="Previous day"
                            icon="back"
                            disabled={!canMoveToPreviousDay}
                            onClick={() => {
                              if (canMoveToPreviousDay) {
                                setAgendaDayLabel(
                                  agendaDayLabels[selectedAgendaDayIndex - 1] ??
                                    null,
                                );
                              }
                            }}
                          />
                          <SegmentedControl
                            options={agendaDayLabels.map((label) => ({
                              label: formatAgendaDayTickerLabel(label),
                              value: label,
                              title: label,
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
                                  agendaDayLabels[selectedAgendaDayIndex + 1] ??
                                    null,
                                );
                              }
                            }}
                          />
                        </div>
                        <div className="agenda-time-zone-control">
                          <span className="agenda-control-label">
                            Time zone
                          </span>
                          <SegmentedControl
                            ariaLabel="Agenda time zone"
                            options={[
                              {
                                label: 'Event time',
                                value: 'event' as const,
                                title: agendaEventTimeZone
                                  ? `Event time (${agendaEventTimeZone})`
                                  : 'Event time (cached)',
                              },
                              {
                                label: 'Local time',
                                value: 'local' as const,
                                title: `Local time (${agendaLocalTimeZone})`,
                                disabled: agendaEventTimeZone === null,
                              },
                            ]}
                            value={agendaTimeZoneMode}
                            onChange={setAgendaTimeZoneMode}
                          />
                          <span className="agenda-control-help">
                            {agendaTimeZoneMode === 'event'
                              ? (agendaEventTimeZone ??
                                'Refresh event to enable local time')
                              : agendaLocalTimeZone}
                          </span>
                        </div>
                        <SegmentedControl
                          options={filterOptions}
                          value={agendaFilter}
                          onChange={setAgendaFilter}
                        />
                      </div>

                      <div className="agenda-shell-grid">
                        <div
                          className="agenda-shell-main"
                          ref={agendaCanvasMeasureRef}
                        >
                          {visibleAgendaTalks.length ? (
                            <AgendaTimelineCanvas
                              visibleAgendaTalks={visibleAgendaTalks}
                              selectedAgendaTalkId={
                                selectedAgendaTalk?.id ?? null
                              }
                              viewportRef={agendaCanvasMeasureRef}
                              onOpenTalk={(talk) => {
                                setSelectedAgendaTalkId(talk.id);
                                setSelectedEventId(talk.conferenceId);
                                setAgendaDayLabel(talk.dayLabel);
                              }}
                              onOpenTalkSlides={(talk) => {
                                void openAgendaTalkSlides(talk);
                              }}
                              onOpenTalkNotes={(talk) => {
                                void openAgendaTalkNotes(talk);
                              }}
                              onOpenTalkMaterials={handleOpenTalkMaterials}
                              onOpenLinkedAgenda={handleOpenLinkedAgenda}
                              onOpenLinkedAgendaInApp={
                                handleOpenLinkedAgendaInApp
                              }
                              onCopyLinkedAgenda={(talk, event) => {
                                void handleCopyLinkedAgenda(talk, event);
                              }}
                              onToggleBookmark={(talk) => {
                                void handleAgendaTalkBookmarkToggle(talk);
                              }}
                            />
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
                        </div>
                      </div>

                      {agendaMaterialsTalk ? (
                        <div className="dialog-backdrop agenda-talk-material-dialog-backdrop">
                          <DialogSurface
                            title={`Materials for ${agendaMaterialsTalk.title}`}
                            body={
                              <div className="agenda-talk-material-dialog">
                                <div className="agenda-talk-link-actions">
                                  <PrimaryButton
                                    icon="open"
                                    onClick={() => {
                                      void handleOpenContributionLink(
                                        agendaMaterialsTalk.contributionUrl,
                                      );
                                    }}
                                    disabled={
                                      !agendaMaterialsTalk.contributionUrl
                                    }
                                  >
                                    Link
                                  </PrimaryButton>
                                  <IconButton
                                    label={`Copy contribution link for ${agendaMaterialsTalk.title}`}
                                    title="Copy contribution link"
                                    icon="copy"
                                    onClick={(event) => {
                                      void handleCopyLink(
                                        agendaMaterialsTalk.contributionUrl,
                                        event,
                                        'Copied to clipboard',
                                      );
                                    }}
                                    disabled={
                                      !agendaMaterialsTalk.contributionUrl
                                    }
                                  />
                                </div>
                                <div className="agenda-talk-detail-topline">
                                  <StatusLabel
                                    label={agendaMaterialsTalk.dayLabel}
                                    tone="neutral"
                                    icon="event"
                                  />
                                  <StatusLabel
                                    label={agendaMaterialsTalk.timeRangeLabel}
                                    tone="neutral"
                                    icon="info"
                                  />
                                  <StatusLabel
                                    label={agendaMaterialsTalk.room}
                                    tone="neutral"
                                    icon="agenda"
                                  />
                                  {agendaMaterialsTalk.upstreamSummary ? (
                                    <StatusLabel
                                      label={
                                        agendaMaterialsTalk.upstreamSummary
                                      }
                                      tone={
                                        agendaMaterialsTalk.upstreamStatus ===
                                        'missing'
                                          ? 'warning'
                                          : 'neutral'
                                      }
                                      icon="info"
                                    />
                                  ) : null}
                                </div>

                                {agendaMaterialsPdfMaterials.length ? (
                                  <div className="agenda-talk-materials">
                                    <div className="surface-panel-header">
                                      <h3>PDF materials</h3>
                                      <p>
                                        Choose the deck to remember as the
                                        default for this talk.
                                      </p>
                                    </div>
                                    <div className="agenda-talk-material-list">
                                      {agendaMaterialsPdfMaterials.map(
                                        (material) => (
                                          <Row
                                            key={material.id}
                                            variant="list"
                                            selected={material.selected}
                                            onClick={() => {
                                              void handleSelectSelectedTalkDeck(
                                                material.id,
                                              );
                                            }}
                                            ariaLabel={`Select ${material.title} for ${agendaMaterialsTalk.title}`}
                                            title={formatMaterialLabel(
                                              material,
                                            )}
                                            meta={
                                              <StatusLabel
                                                label={
                                                  material.selected
                                                    ? 'Default deck'
                                                    : 'Available PDF'
                                                }
                                                tone={
                                                  material.selected
                                                    ? 'success'
                                                    : 'neutral'
                                                }
                                                icon={
                                                  material.selected
                                                    ? 'check'
                                                    : 'open'
                                                }
                                              />
                                            }
                                            detail={
                                              material.upstreamStatus ? (
                                                <StatusLabel
                                                  label={
                                                    material.upstreamStatus ===
                                                    'missing'
                                                      ? 'Removed upstream'
                                                      : material.upstreamStatus ===
                                                          'changed'
                                                        ? 'Updated upstream'
                                                        : 'Still available upstream'
                                                  }
                                                  tone={
                                                    material.upstreamStatus ===
                                                    'missing'
                                                      ? 'warning'
                                                      : material.upstreamStatus ===
                                                          'changed'
                                                        ? 'neutral'
                                                        : 'success'
                                                  }
                                                  icon="info"
                                                />
                                              ) : null
                                            }
                                          />
                                        ),
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="empty-state agenda-detail-empty-state">
                                    <Icon name="info" />
                                    <strong>No annotatable PDF</strong>
                                    <span>
                                      This talk has no PDF material, so the
                                      attachments stay in this transient
                                      surface.
                                    </span>
                                  </div>
                                )}

                                {agendaMaterialsNonPdfMaterials.length ? (
                                  <div className="agenda-talk-materials">
                                    <div className="surface-panel-header">
                                      <h3>Other materials</h3>
                                      <p>
                                        Non-PDF attachments remain visible here
                                        without entering the slide viewer.
                                      </p>
                                    </div>
                                    <div className="agenda-talk-material-list">
                                      {agendaMaterialsNonPdfMaterials.map(
                                        (material) => (
                                          <Row
                                            key={material.id}
                                            variant="list"
                                            title={formatMaterialLabel(
                                              material,
                                            )}
                                            meta={
                                              <StatusLabel
                                                label="Non-PDF material"
                                                tone="neutral"
                                                icon="info"
                                              />
                                            }
                                          />
                                        ),
                                      )}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            }
                            primaryLabel={
                              agendaMaterialsDeck ? 'Open slides' : 'Done'
                            }
                            secondaryLabel="Close"
                            onPrimary={() => {
                              if (agendaMaterialsDeck) {
                                void handleOpenSelectedTalkDeck();
                                return;
                              }

                              setAgendaMaterialsTalkId(null);
                            }}
                            onSecondary={() => {
                              setAgendaMaterialsTalkId(null);
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="empty-state agenda-empty-state">
                      <Icon name="agenda" />
                      <strong>No stored talks yet</strong>
                      <span>
                        Open a conference event to populate the temporary agenda
                        list.
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state agenda-empty-state">
                  <Icon name="agenda" />
                  <strong>No active event selected</strong>
                  <span>
                    Open a stored conference event from Library to browse its
                    agenda.
                  </span>
                </div>
              )}
            </section>
          )}

          {destination === 'bookmarks' && (
            <section className="page-stack">
              <DetailsSurface
                title="Bookmarked talks"
                subtitle="Saved talks stay attached to the current conference and reopen the matching agenda day."
              >
                {bookmarkedAgendaTalks.length ? (
                  <div className="agenda-list">
                    {bookmarkedAgendaTalks.map((talk) => (
                      <Row
                        key={talk.id}
                        variant="list"
                        selected={talk.id === selectedAgendaTalk?.id}
                        onClick={() => {
                          openAgendaTalkFromIndex(talk);
                        }}
                        ariaLabel={`Open bookmarked talk ${talk.title}`}
                        title={talk.title}
                        meta={
                          <>
                            {talk.dayLabel} - {talk.timeRangeLabel} -{' '}
                            {talk.speaker}
                            {talk.room !== 'Room unavailable'
                              ? ` - ${talk.room}`
                              : ''}
                          </>
                        }
                        detail={
                          <div className="row-pills">
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
                            {talk.upstreamSummary ? (
                              <StatusLabel
                                label={talk.upstreamSummary}
                                tone={
                                  talk.upstreamStatus === 'missing'
                                    ? 'warning'
                                    : 'neutral'
                                }
                                icon="info"
                              />
                            ) : null}
                          </div>
                        }
                        action={
                          <div
                            className="row-action"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            <IconButton
                              label="Remove bookmark"
                              icon="bookmark"
                              pressed
                              title="Remove bookmark"
                              onClick={() => {
                                void toggleAgendaTalkBookmark(talk.id, false);
                              }}
                            />
                          </div>
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Icon name="bookmark" />
                    <strong>No bookmarked talks yet</strong>
                    <span>Bookmark a talk from the agenda to pin it here.</span>
                  </div>
                )}
              </DetailsSurface>
            </section>
          )}

          {destination === 'slides' && (
            <section
              className={`page-stack page-stack--slides${
                viewerMode === 'notes' ? ' is-notes-mode' : ''
              }`}
            >
              <div className="slides-view-controls">
                <div className="slides-view-controls-row">
                  <IconButton
                    label="Back"
                    icon="back"
                    onClick={() => setDestination('agenda')}
                  />
                  <div className="slides-view-link-actions">
                    <PrimaryButton
                      icon="open"
                      onClick={() => {
                        void handleOpenSelectedPdfLink();
                      }}
                      disabled={!activeSlideSelectedMaterial?.sourceUrl}
                    >
                      Link
                    </PrimaryButton>
                    <IconButton
                      label={`Copy contribution link for ${selectedAgendaTalk?.title ?? 'selected talk'}`}
                      title="Copy contribution link"
                      icon="copy"
                      onClick={(event) => {
                        void handleCopyLink(
                          selectedAgendaTalk?.contributionUrl ?? null,
                          event,
                          'Copied to clipboard',
                        );
                      }}
                      disabled={!selectedAgendaTalk?.contributionUrl}
                    />
                    <IconButton
                      label={`Copy PDF link for ${activeSlideSelectedMaterial?.title ?? 'selected deck'}`}
                      title="Copy PDF link"
                      icon="copy"
                      onClick={(event) => {
                        void handleCopyLink(
                          activeSlideSelectedMaterial?.sourceUrl ?? null,
                          event,
                          'Copied to clipboard',
                        );
                      }}
                      disabled={!activeSlideSelectedMaterial?.sourceUrl}
                    />
                  </div>
                  {activeSlideMaterials.length > 1 ? (
                    <SegmentedControl
                      options={activeSlideMaterials.map((material) => ({
                        label: material.title,
                        value: material.id,
                      }))}
                      value={
                        activeSlideSelectedMaterialId ??
                        activeSlideMaterials[0]?.id ??
                        ''
                      }
                      onChange={(deckId) => {
                        void handleSelectSelectedTalkDeck(deckId);
                      }}
                    />
                  ) : null}
                  {activeSlideDownloadStatus?.kind === 'downloading' ? (
                    <IconButton
                      label="Cancel download"
                      title="Cancel download"
                      icon="trash"
                      onClick={() => {
                        void handleCancelDeckDownload();
                      }}
                    />
                  ) : activeSlideDownloadStatus?.kind === 'error' ? (
                    <IconButton
                      label="Retry download"
                      title="Retry download"
                      icon="refresh"
                      onClick={() => {
                        void handleRetryDeckDownload();
                      }}
                    />
                  ) : null}
                  <PrimaryButton
                    icon="export"
                    onClick={() => {
                      void handleExportNotes();
                    }}
                    disabled={
                      !selectedEventId ||
                      activeSlideDownloadStatus?.kind === 'downloading' ||
                      activeSlideDownloadStatus?.kind === 'error' ||
                      activeSlideDownloadStatus?.kind === 'canceled' ||
                      exportState.kind === 'rendering' ||
                      exportState.kind === 'writing' ||
                      exportState.kind === 'preparing'
                    }
                  >
                    Export notes
                  </PrimaryButton>
                </div>
                {commandBarStatus ? (
                  <div className="slides-view-controls-status">
                    {commandBarStatus}
                  </div>
                ) : null}
              </div>
              {selectedAgendaTalk ? (
                <>
                  {activeSlideDownloadStatus?.kind === 'downloading' ? (
                    <div className="dialog-backdrop slide-download-dialog">
                      <DialogSurface
                        title={`Downloading ${activeSlideTitle}`}
                        body={
                          <div className="slide-download-progress">
                            <p className="slide-download-progress-copy">
                              {activeSlideDownloadStatus.message ??
                                'Preparing download...'}
                            </p>
                            <progress
                              className="slide-download-progress-bar"
                              value={
                                activeSlideDownloadProgress?.percentComplete ??
                                undefined
                              }
                              max={100}
                            />
                            <div className="slide-download-progress-stats">
                              <StatusLabel
                                label={`${formatByteCount(activeSlideDownloadStatus.bytesDownloaded)} downloaded`}
                                tone="neutral"
                                icon="info"
                              />
                              <StatusLabel
                                label={
                                  activeSlideDownloadPercent !== null
                                    ? `${Math.round(activeSlideDownloadPercent)}% complete`
                                    : 'Awaiting size information'
                                }
                                tone="neutral"
                                icon="refresh"
                              />
                              <StatusLabel
                                label={`Elapsed ${formatDuration(activeSlideDownloadProgress?.elapsedMilliseconds ?? 0)}`}
                                tone="neutral"
                                icon="info"
                              />
                              <StatusLabel
                                label={formatTransferRate(
                                  activeSlideDownloadProgress?.bytesPerSecond ??
                                    null,
                                )}
                                tone="neutral"
                                icon="info"
                              />
                            </div>
                          </div>
                        }
                        primaryLabel="Cancel download"
                        onPrimary={() => {
                          void handleCancelDeckDownload();
                        }}
                      />
                    </div>
                  ) : null}
                  {viewerMode === 'slides' ? (
                    <PdfPreview
                      filePath={
                        slideViewerState.kind === 'ready'
                          ? slideViewerState.filePath
                          : null
                      }
                      title={activeSlideTitle}
                      conferenceId={activeSlideConferenceId}
                      talkId={activeSlideTalkId}
                      workspaceMode={viewerMode}
                      onWorkspaceModeChange={handleViewerModeChange}
                      onOpenIndicoEvent={openIndicoEventInApp}
                      onSlideMetricsChange={setSlideViewerMetrics}
                      workspaceDeckId={activeSlideDeckId}
                      onRetryLoad={handleRetryPdfLoad}
                      scrollContainerRef={pageSurfaceRef}
                      penThickness={
                        appSettings?.penThickness ?? DEFAULT_PEN_THICKNESS
                      }
                      onPenThicknessChange={setPenThickness}
                      onBackToAgenda={() => {
                        setDestination('agenda');
                      }}
                    />
                  ) : (
                    <ResizableNotesWorkspace
                      reference={
                        slideViewerState.kind === 'ready' ? (
                          <PdfPreview
                            filePath={slideViewerState.filePath}
                            title={`Reference slides for ${activeSlideTitle}`}
                            conferenceId={activeSlideConferenceId}
                            talkId={activeSlideTalkId}
                            workspaceDeckId={activeSlideDeckId}
                            workspaceMode={viewerMode}
                            onWorkspaceModeChange={handleViewerModeChange}
                            penThickness={
                              appSettings?.penThickness ?? DEFAULT_PEN_THICKNESS
                            }
                            onPenThicknessChange={setPenThickness}
                            onSlideMetricsChange={setSlideViewerMetrics}
                          />
                        ) : (
                          <div className="notes-reference-empty">
                            <Icon name="info" />
                            <strong>No slide reference</strong>
                            <span>Write notes independently of a PDF.</span>
                          </div>
                        )
                      }
                    >
                      <PdfPreview
                        filePath={null}
                        blankPageMode
                        workspaceSourceUrl={`notebook:${activeSlideTalkId ?? selectedAgendaTalk?.id ?? ''}`}
                        title={`Notes for ${selectedAgendaTalk?.title ?? activeSlideTitle}`}
                        conferenceId={selectedAgendaTalk?.conferenceId ?? null}
                        talkId={selectedAgendaTalk?.id ?? null}
                        workspaceDeckId={notesDeckId}
                        {...(slideViewerState.kind !== 'ready'
                          ? {
                              workspaceMode: viewerMode,
                              onWorkspaceModeChange: handleViewerModeChange,
                            }
                          : {})}
                        penThickness={
                          appSettings?.penThickness ?? DEFAULT_PEN_THICKNESS
                        }
                        onPenThicknessChange={setPenThickness}
                        onBackToAgenda={() => {
                          setDestination('agenda');
                        }}
                      />
                    </ResizableNotesWorkspace>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <Icon name="agenda" />
                  <strong>No talk selected</strong>
                  <span>
                    Pick a talk from the agenda to open its slide notes.
                  </span>
                </div>
              )}
            </section>
          )}

          {destination === 'annotated' && (
            <section className="page-stack">
              <DetailsSurface
                title="Annotated talks"
                subtitle="Annotated slides remain attached to the active conference and reopen the matching agenda day."
              >
                {annotatedAgendaTalks.length ? (
                  <div className="agenda-list">
                    {annotatedAgendaTalks.map((talk) => (
                      <Row
                        key={talk.id}
                        variant="list"
                        selected={talk.id === selectedAgendaTalk?.id}
                        onClick={() => {
                          openAgendaTalkFromIndex(talk);
                        }}
                        ariaLabel={`Open annotated talk ${talk.title}`}
                        title={talk.title}
                        meta={
                          <>
                            {talk.dayLabel} - {talk.timeRangeLabel} -{' '}
                            {talk.speaker}
                            {talk.room !== 'Room unavailable'
                              ? ` - ${talk.room}`
                              : ''}
                          </>
                        }
                        detail={
                          <div className="row-pills">
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
                            {talk.upstreamSummary ? (
                              <StatusLabel
                                label={talk.upstreamSummary}
                                tone={
                                  talk.upstreamStatus === 'missing'
                                    ? 'warning'
                                    : 'neutral'
                                }
                                icon="info"
                              />
                            ) : null}
                          </div>
                        }
                        action={
                          <div
                            className="row-action"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            <IconButton
                              label={
                                talk.bookmarked
                                  ? 'Remove bookmark'
                                  : 'Bookmark talk'
                              }
                              icon="bookmark"
                              pressed={talk.bookmarked}
                              title={
                                talk.bookmarked
                                  ? 'Remove bookmark'
                                  : 'Bookmark talk'
                              }
                              onClick={() => {
                                void toggleAgendaTalkBookmark(
                                  talk.id,
                                  !talk.bookmarked,
                                );
                              }}
                            />
                          </div>
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Icon name="annotated" />
                    <strong>No annotated talks yet</strong>
                    <span>
                      Annotate slides in Slide Notes and they will appear here.
                    </span>
                  </div>
                )}
              </DetailsSurface>
            </section>
          )}

          {destination === 'search' && (
            <section className="page-stack">
              <DetailsSurface
                title="Search talks"
                subtitle="Search title, speaker, session, contribution ID, and keywords across the current conference."
              >
                {selectedEventId ? (
                  <div className="agenda-search">
                    <label className="field agenda-search-field">
                      <span>Search talks</span>
                      <input
                        ref={agendaSearchInputRef}
                        value={agendaSearchQuery}
                        onChange={(event) =>
                          setAgendaSearchQuery(event.target.value)
                        }
                        type="search"
                        autoComplete="off"
                        placeholder="Try title, speaker, session, or contribution ID"
                      />
                    </label>
                    <div className="agenda-list-meta">
                      <StatusLabel
                        label={`${searchAgendaTalks.length} result${searchAgendaTalks.length === 1 ? '' : 's'}`}
                        icon="search"
                      />
                      <StatusLabel
                        label={selectedAgendaEvent?.title ?? activeEvent.title}
                        tone="neutral"
                        icon="event"
                      />
                    </div>
                    {agendaTalksLoading ? (
                      <div className="empty-state agenda-empty-state">
                        <Icon name="search" />
                        <strong>Loading searchable talks</strong>
                        <span>
                          Search stays active while the event refreshes.
                        </span>
                      </div>
                    ) : agendaTalksError ? (
                      <div className="empty-state agenda-empty-state">
                        <Icon name="info" />
                        <strong>Search unavailable</strong>
                        <span>{agendaTalksError}</span>
                      </div>
                    ) : searchAgendaTalks.length ? (
                      <div className="agenda-list">
                        {searchAgendaTalks.map((talk) => (
                          <Row
                            key={talk.id}
                            variant="list"
                            selected={talk.id === selectedAgendaTalk?.id}
                            onClick={() => {
                              openSearchResult(talk);
                            }}
                            ariaLabel={`Open search result for ${talk.title}`}
                            title={talk.title}
                            meta={
                              <>
                                {talk.dayLabel} - {talk.timeRangeLabel} -{' '}
                                {talk.speaker}
                                {talk.room !== 'Room unavailable'
                                  ? ` - ${talk.room}`
                                  : ''}
                              </>
                            }
                            detail={
                              <div className="row-pills">
                                <StatusLabel
                                  label={talk.contributionId}
                                  tone="neutral"
                                  icon="info"
                                />
                                <StatusLabel
                                  label={talk.sessionTitle}
                                  tone="neutral"
                                  icon="agenda"
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
                                {talk.upstreamSummary ? (
                                  <StatusLabel
                                    label={talk.upstreamSummary}
                                    tone={
                                      talk.upstreamStatus === 'missing'
                                        ? 'warning'
                                        : 'neutral'
                                    }
                                    icon="info"
                                  />
                                ) : null}
                              </div>
                            }
                            action={
                              <div
                                className="row-action"
                                onClick={(event) => {
                                  event.stopPropagation();
                                }}
                              >
                                <IconButton
                                  label={
                                    talk.bookmarked
                                      ? 'Remove bookmark'
                                      : 'Bookmark talk'
                                  }
                                  icon="bookmark"
                                  pressed={talk.bookmarked}
                                  title={
                                    talk.bookmarked
                                      ? 'Remove bookmark'
                                      : 'Bookmark talk'
                                  }
                                  onClick={() => {
                                    void toggleAgendaTalkBookmark(
                                      talk.id,
                                      !talk.bookmarked,
                                    );
                                  }}
                                />
                              </div>
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state agenda-empty-state">
                        <Icon name="search" />
                        <strong>No matching talks</strong>
                        <span>
                          Try a title, speaker, session, contribution ID, or
                          keyword.
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="empty-state agenda-empty-state">
                    <Icon name="search" />
                    <strong>No active event selected</strong>
                    <span>
                      Open a conference first, then search across its talks.
                    </span>
                  </div>
                )}
              </DetailsSurface>
            </section>
          )}

          {destination === 'settings' && (
            <section className="page-stack">
              <div className="settings-panel">
                <DetailsSurface
                  title="Application settings"
                  subtitle="Local data access."
                >
                  <div className="settings-list">
                    <div className="settings-row">
                      <span>App version</span>
                      <div className="settings-row-stack">
                        <strong>{appVersionText}</strong>
                      </div>
                    </div>
                    <div className="settings-row">
                      <span>Electron version</span>
                      <div className="settings-row-stack">
                        <strong>{electronVersionText}</strong>
                      </div>
                    </div>
                    <div className="settings-row">
                      <span>Data folder</span>
                      <div className="settings-row-stack">
                        <strong>{dataFolderPath || 'Loading...'}</strong>
                        <div className="settings-row-actions">
                          <IconButton
                            label="Open data folder"
                            icon="open"
                            onClick={() => {
                              void window.indicoInk.openDataFolder();
                            }}
                            disabled={!dataFolderPath}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="settings-row settings-row-column">
                      <span>Logging</span>
                      <div className="settings-row-stack settings-row-stack-wide">
                        <label className="settings-toggle">
                          <input
                            type="checkbox"
                            checked={appSettings?.recordLogging ?? false}
                            onChange={(event) => {
                              void setRecordLoggingEnabled(
                                event.target.checked,
                              );
                            }}
                            disabled={isSavingAppSettings || !appSettings}
                          />
                          <span>
                            Record startup events and diagnostics in the data
                            folder.
                          </span>
                        </label>
                        <div className="settings-row-hint">
                          Uncaught exceptions are always recorded. The log file
                          stays under 5 MB.
                        </div>
                        {appSettingsError ? (
                          <div className="settings-row-error">
                            {appSettingsError}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="settings-row settings-row-column">
                      <span>Indico API keys</span>
                      <div className="settings-row-stack settings-row-stack-wide">
                        {apiKeySummaries.length ? (
                          <div
                            className="settings-api-key-list"
                            aria-label="Saved Indico API keys"
                          >
                            {apiKeySummaries.map((apiKey) => (
                              <div
                                className="settings-api-key-row"
                                key={apiKey.origin}
                              >
                                <div className="settings-api-key-text">
                                  <strong>{apiKey.origin}</strong>
                                  <span>
                                    {formatApiKeyUpdatedAt(apiKey.updatedAt)}
                                  </span>
                                </div>
                                <IconButton
                                  label={`Delete API key for ${apiKey.origin}`}
                                  icon="trash"
                                  onClick={() =>
                                    requestDeleteIndicoApiKey(apiKey)
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="settings-empty">
                            No saved API keys
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="settings-row settings-row-column">
                      <span>OpenAI agenda extraction</span>
                      <div className="settings-row-stack settings-row-stack-wide">
                        <div className="settings-api-key-text">
                          <strong>
                            {openAiConfiguration?.baseUrl ??
                              OPENAI_DEFAULT_BASE_URL}
                          </strong>
                          <span>
                            {openAiConfiguration?.model ?? OPENAI_DEFAULT_MODEL}
                            {' · '}
                            {openAiConfiguration?.reasoningEffort ?? 'medium'}
                            {' reasoning'}
                          </span>
                          <span>
                            {openAiConfiguration?.hasApiKey
                              ? openAiConfiguration.apiKeyUpdatedAt
                                ? `Key ${formatApiKeyUpdatedAt(openAiConfiguration.apiKeyUpdatedAt)}`
                                : 'Key saved'
                              : 'No saved API key'}
                          </span>
                        </div>
                        <div className="settings-row-actions">
                          <PrimaryButton
                            icon="settings"
                            onClick={() => {
                              void showOpenAiConfigurationDialog({
                                operation: 'settings',
                                reason: 'settings',
                                message: 'Configure OpenAI agenda extraction.',
                              });
                            }}
                          >
                            Configure
                          </PrimaryButton>
                          <IconButton
                            label="Delete OpenAI API key"
                            icon="trash"
                            disabled={!openAiConfiguration?.hasApiKey}
                            onClick={() => {
                              void deleteOpenAiApiKey();
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </DetailsSurface>
              </div>
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

          {apiKeyDeleteTarget ? (
            <div className="dialog-backdrop" role="presentation">
              <DialogSurface
                title="Delete API key"
                body={
                  <div className="dialog-copy">
                    <p>
                      The saved API key for{' '}
                      <strong>{apiKeyDeleteTarget.origin}</strong> will be
                      removed from this computer.
                    </p>
                  </div>
                }
                primaryLabel="Delete key"
                secondaryLabel="Cancel"
                onPrimary={() => void confirmDeleteIndicoApiKey()}
                onSecondary={() => setApiKeyDeleteTarget(null)}
              />
            </div>
          ) : null}

          {apiKeyDialogRequest ? (
            <div className="dialog-backdrop" role="presentation">
              <DialogSurface
                title={
                  apiKeyDialogRequest.kind === 'event'
                    ? 'Private event'
                    : apiKeyDialogRequest.kind === 'refresh'
                      ? 'API key required to refresh'
                      : 'Private slides'
                }
                body={
                  <div className="dialog-copy">
                    <p>
                      {apiKeyDialogRequest.kind === 'event'
                        ? 'This event'
                        : apiKeyDialogRequest.kind === 'refresh'
                          ? 'Refreshing this event'
                          : 'This slide deck'}{' '}
                      at <strong>{apiKeyDialogRequest.origin}</strong> needs an
                      API key before it can be{' '}
                      {apiKeyDialogRequest.kind === 'refresh'
                        ? 'refreshed.'
                        : 'opened.'}
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
                  setApiKeyDialogRequest(null);
                  setApiKeyValue('');
                  setApiKeyError(null);
                }}
              />
            </div>
          ) : null}

          {openAiDialogRequest ? (
            <div className="dialog-backdrop" role="presentation">
              <DialogSurface
                title={
                  openAiDialogRequest.reason === 'authentication-failed'
                    ? 'OpenAI authentication required'
                    : 'Configure OpenAI agenda extraction'
                }
                body={
                  <div className="dialog-copy">
                    <p>{openAiDialogRequest.message}</p>
                    <label className="field">
                      <span>Endpoint URL</span>
                      <input
                        autoFocus
                        value={openAiBaseUrl}
                        onChange={(event) => {
                          setOpenAiBaseUrl(event.target.value);
                          setOpenAiError(null);
                        }}
                        type="url"
                        autoComplete="off"
                        aria-label="OpenAI endpoint URL"
                      />
                    </label>
                    <label className="field">
                      <span>Model</span>
                      <input
                        value={openAiModel}
                        onChange={(event) => {
                          setOpenAiModel(event.target.value);
                          setOpenAiError(null);
                        }}
                        autoComplete="off"
                        aria-label="OpenAI model"
                      />
                    </label>
                    <label className="field">
                      <span>Reasoning effort</span>
                      <select
                        value={openAiReasoningEffort}
                        onChange={(event) => {
                          setOpenAiReasoningEffort(
                            event.target.value as OpenAiReasoningEffort,
                          );
                          setOpenAiError(null);
                        }}
                        aria-label="OpenAI reasoning effort"
                      >
                        {OPENAI_REASONING_EFFORTS.map((effort) => (
                          <option key={effort} value={effort}>
                            {effort}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>API key</span>
                      <input
                        value={openAiApiKey}
                        onChange={(event) => {
                          setOpenAiApiKey(event.target.value);
                          setOpenAiError(null);
                        }}
                        type="password"
                        autoComplete="off"
                        placeholder={
                          openAiConfiguration?.hasApiKey
                            ? 'Enter a replacement API key'
                            : 'Paste API key'
                        }
                        aria-label="OpenAI API key"
                        aria-invalid={openAiError ? 'true' : undefined}
                      />
                    </label>
                    {openAiError ? (
                      <div className="field-error">
                        <StatusLabel
                          label={openAiError}
                          tone="error"
                          icon="info"
                        />
                      </div>
                    ) : (
                      <div className="field-help">
                        The API key is saved locally using Electron safeStorage
                        and is never exposed to the renderer after saving.
                      </div>
                    )}
                  </div>
                }
                primaryLabel={
                  isSavingOpenAi
                    ? 'Verifying...'
                    : openAiDialogRequest.operation === 'settings'
                      ? 'Save configuration'
                      : 'Save and continue'
                }
                primaryDisabled={isSavingOpenAi}
                secondaryLabel="Cancel"
                onPrimary={() => void handleSaveOpenAiConfiguration()}
                onSecondary={() => {
                  setOpenAiDialogRequest(null);
                  setOpenAiApiKey('');
                  setOpenAiError(null);
                }}
              />
            </div>
          ) : null}

          {refreshState.kind === 'conflict' ? (
            <div className="dialog-backdrop" role="presentation">
              <DialogSurface
                title="Refresh conflict"
                body={
                  <div className="dialog-copy">
                    <p>{refreshState.message}</p>
                    <div className="refresh-conflict-list">
                      {refreshState.conflicts.map((conflict) => (
                        <div key={conflict.talkId} className="refresh-conflict">
                          <strong>{conflict.talkTitle}</strong>
                          <span>{conflict.message}</span>
                          <span>
                            {conflict.selectedDeckTitle ?? 'Selected deck'}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p>
                      Keeping the current deck preserves the cached PDF and its
                      annotations. Replacing it updates the cache from the
                      refreshed event.
                    </p>
                  </div>
                }
                primaryLabel="Replace deck"
                secondaryLabel="Keep deck"
                onPrimary={() => {
                  setRefreshState({
                    kind: 'refreshing',
                    message:
                      'Replacing the cached deck and refreshing the event...',
                  });
                  void handleResolveRefreshConflict('replace');
                }}
                onSecondary={() => {
                  setRefreshState({
                    kind: 'refreshing',
                    message:
                      'Refreshing while keeping the existing deck cache...',
                  });
                  void handleResolveRefreshConflict('keep');
                }}
              />
            </div>
          ) : null}

          {refreshState.kind === 'error' && !apiKeyDialogRequest ? (
            <div className="dialog-backdrop" role="presentation">
              <DialogSurface
                title="Refresh failed"
                body={
                  <div className="dialog-copy">
                    <p>{refreshState.message}</p>
                  </div>
                }
                primaryLabel="Dismiss"
                onPrimary={() => {
                  setRefreshState({ kind: 'idle' });
                }}
              />
            </div>
          ) : null}

          {exportState.kind !== 'idle' ? (
            <div className="dialog-backdrop" role="presentation">
              <DialogSurface
                title="Export notes"
                body={
                  <div className="dialog-copy">
                    <p>{exportState.label}</p>
                    {exportState.kind === 'rendering' ||
                    exportState.kind === 'writing' ? (
                      <StatusLabel
                        label={
                          exportState.total > 0
                            ? `${exportState.completed} / ${exportState.total} annotated slides`
                            : 'Preparing export'
                        }
                        tone="neutral"
                        icon="info"
                      />
                    ) : null}
                    {exportState.kind === 'done' ? (
                      <p>{exportState.filePath}</p>
                    ) : null}
                  </div>
                }
                primaryLabel={
                  exportState.kind === 'done'
                    ? 'Open file location'
                    : exportState.kind === 'empty' ||
                        exportState.kind === 'error' ||
                        exportState.kind === 'canceled'
                      ? 'Close'
                      : 'Cancel export'
                }
                secondaryLabel={
                  exportState.kind === 'done' ||
                  exportState.kind === 'empty' ||
                  exportState.kind === 'error' ||
                  exportState.kind === 'canceled'
                    ? 'Dismiss'
                    : 'Keep working'
                }
                onPrimary={() => {
                  if (exportState.kind === 'done') {
                    void window.indicoInk.openExportFileLocation(
                      exportState.filePath,
                    );
                    setExportState({ kind: 'idle' });
                    return;
                  }

                  if (
                    exportState.kind === 'empty' ||
                    exportState.kind === 'error' ||
                    exportState.kind === 'canceled'
                  ) {
                    setExportState({ kind: 'idle' });
                    return;
                  }

                  handleCancelExport();
                }}
                onSecondary={() => {
                  setExportState({ kind: 'idle' });
                }}
              />
            </div>
          ) : null}
        </main>
        {copyTooltip ? (
          <div
            className="copy-tooltip"
            role="status"
            aria-live="polite"
            style={{
              left: `${Math.max(12, copyTooltip.x)}px`,
              top: `${Math.max(12, copyTooltip.y)}px`,
            }}
          >
            {copyTooltip.message}
          </div>
        ) : null}
      </section>
    </div>
  );
}
