import React from 'react';

import {
  createPointerToolState,
  getPointerCursor,
  getPointerInteractionMode,
  getPointerOverlayClass,
  type PointerEventKind,
  type PointerInteractionMode,
  type PointerSample,
  type PointerTool,
} from './pointerTools';
import {
  clampPdfZoom,
  getFocalScrollPosition,
  getPinchDistance,
  getPinchMidpoint,
  getPinchZoom,
  PDF_ZOOM_STEP,
  type PdfZoomFocalAnchor,
  type PdfZoomPoint,
} from './pdfZoom';
import {
  advanceTouchMomentum,
  getTouchPanVelocity,
  type TouchMomentumVelocity,
  type TouchPanSample,
} from './touchMomentum';
import {
  type NormalizedPagePoint,
  toNormalizedViewportPoint,
} from './inkGeometry';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import {
  createStrokeSegmentCache,
  DEFAULT_PEN_THICKNESS,
  getFitWidthNormalizedPenWidth,
  strokeHitsPoint,
  type InkStroke,
} from './strokeTools';
import { copyTextToClipboard } from './clipboard';
import { parseIndicoEventUrl } from './indicoEvent';
import type {
  PdfWorkspaceHistory,
  PdfWorkspaceSnapshot,
} from './shared/pdfWorkspace';
import {
  DEFAULT_PEN_COLOR_NAMES,
  DEFAULT_PEN_COLORS,
} from './shared/appSettings';
import { IconButton, SegmentedControl } from './ui';
import {
  createConferenceId,
  createDeckId,
  createSlideId,
  createTalkId,
  type TextNote,
} from './persistenceModels';
import { PdfInkLayer, type InkLayerCanvasRefs } from './PdfInkLayer';
import {
  clearInkCanvas,
  drawInkPoints,
  dropExactDuplicatePoints,
  type InkCanvasMetrics,
} from './inkCanvas';
import {
  createWorkspaceHistory,
  createWorkspaceHistoryEntry,
  migrateLegacyWorkspaceHistory,
  pushWorkspaceHistory,
  redoWorkspaceHistory,
  undoWorkspaceHistory,
  type WorkspacePages,
} from './workspaceHistory';
import {
  createStrokeSpatialIndex,
  type StrokeSpatialIndex,
} from './strokeSpatialIndex';
import { diffWorkspaceAnnotations } from './workspaceChanges';

type PdfPreviewState =
  | { kind: 'idle' }
  | {
      kind: 'loading';
      label: string;
      pageCount: number;
      pageSizes: Array<{ width: number; height: number }>;
      pageStatuses: Array<'pending' | 'ready'>;
    }
  | {
      kind: 'ready';
      label: string;
      pageCount: number;
      pageSizes: Array<{ width: number; height: number }>;
      pageStatuses: Array<'pending' | 'ready'>;
    }
  | {
      kind: 'error';
      label: string;
      pageCount: number;
      pageSizes: Array<{ width: number; height: number }>;
      pageStatuses: Array<'pending' | 'ready'>;
    };

type PointerDiagnostics = {
  eventKind: PointerEventKind | 'idle';
  pointerId: number | null;
  pointerType: string;
  button: number;
  buttons: number;
  pressure: number;
  isPrimary: boolean;
  resolvedTool: PointerTool;
  latchedTool: PointerTool | null;
  renderedTool: PointerTool;
  interactionMode: PointerInteractionMode;
  cursor: string;
  overlayClass: string;
};

type PointerMarker = {
  pageIndex: number;
  point: NormalizedPagePoint;
  tool: PointerTool;
};

type PdfLinkAnnotation = {
  annotationType?: number;
  altText?: string;
  contents?: string;
  rect?: number[];
  subtype?: string;
  title?: string;
  unsafeUrl?: string;
  url?: string;
};

type PdfLinkHotspot = {
  label: string;
  url: string;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  isIndicoEvent: boolean;
};

type LinkPopoverState = {
  pageIndex: number;
  link: PdfLinkHotspot;
  x: number;
  y: number;
} | null;

type TextNoteDraft = {
  mode: 'create' | 'edit';
  pageIndex: number;
  noteId: string | null;
  x: number;
  y: number;
  width: number;
  text: string;
};

type TextNoteDragState = {
  pointerId: number;
  noteId: string;
  pageIndex: number;
  startOffsetX: number;
  startOffsetY: number;
  beforeNote: TextNote;
};

type TextNoteResizeState = {
  pointerId: number;
  pageIndex: number;
  startClientX: number;
  startWidth: number;
};

type PointerInteractionResolution = {
  sample: PointerSample;
  toolState: ReturnType<typeof createPointerToolState>;
  interactionMode: PointerInteractionMode;
  renderedTool: PointerTool;
};

type ActiveInkAction =
  | {
      kind: 'draw';
      pointerId: number;
      pageIndex: number;
      stroke: InkStroke;
      renderedPointCount: number;
      metrics: InkCanvasMetrics;
    }
  | {
      kind: 'erase';
      pointerId: number;
      pageIndex: number;
      beforeStrokes: InkStroke[];
      spatialIndex: StrokeSpatialIndex;
    }
  | {
      kind: 'text';
      pointerId: number;
      pageIndex: number;
      startClientX: number;
      startClientY: number;
    }
  | {
      kind: 'pan';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startScrollLeft: number;
      startScrollTop: number;
    }
  | null;

type PinchGesture = {
  initialDistance: number;
  initialZoom: number;
  initialMidpoint: PdfZoomPoint;
  origin: PdfZoomPoint;
  anchor: PdfZoomFocalAnchor | null;
};

type ManualTool = 'pen' | 'text' | 'eraser';

const waitForNextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

const createPageSizes = (pageCount: number) =>
  Array.from({ length: pageCount }, () => ({ width: 0, height: 0 }));

const createPageStatuses = (pageCount: number) =>
  Array.from({ length: pageCount }, () => 'pending' as const) as Array<
    'pending' | 'ready'
  >;

const createEmptyStrokePages = (pageCount: number) =>
  Array.from({ length: pageCount }, () => [] as InkStroke[]);

const createEmptyTextNotePages = (pageCount: number) =>
  Array.from({ length: pageCount }, () => [] as TextNote[]);

const createEmptyLinkHotspotPages = (pageCount: number) =>
  Array.from({ length: pageCount }, () => [] as PdfLinkHotspot[]);

const normalizeViewportRect = (
  viewport: {
    convertToViewportRectangle: (rect: number[]) => number[];
  },
  rect: number[],
) => {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
  const left = Math.min(x1 ?? 0, x2 ?? 0);
  const top = Math.min(y1 ?? 0, y2 ?? 0);
  const right = Math.max(x1 ?? 0, x2 ?? 0);
  const bottom = Math.max(y1 ?? 0, y2 ?? 0);

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
};

const normalizeLinkHotspotLabel = (value: string) =>
  value.replace(/\s+/g, ' ').trim();

type CopyTooltipState = {
  message: string;
  x: number;
  y: number;
} | null;

export const isLikelyDownloadableUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return false;
  }

  if (url.pathname.endsWith('/')) {
    return false;
  }

  const lastPathSegment = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const extension = lastPathSegment.includes('.')
    ? lastPathSegment.slice(lastPathSegment.lastIndexOf('.') + 1)
    : '';

  return Boolean(
    lastPathSegment &&
    !lastPathSegment.startsWith('.') &&
    extension &&
    /^[A-Za-z0-9]{1,8}$/.test(extension),
  );
};

const getLinkHotspotsForPage = async (
  page: {
    getAnnotations?: (options: {
      intent: 'display';
    }) => Promise<PdfLinkAnnotation[]>;
  },
  viewport: {
    convertToViewportRectangle: (rect: number[]) => number[];
  },
): Promise<PdfLinkHotspot[]> => {
  const annotations =
    (await page.getAnnotations?.({ intent: 'display' })) ?? [];
  const hotspots: PdfLinkHotspot[] = [];

  for (const annotation of annotations) {
    const url =
      typeof annotation.url === 'string'
        ? annotation.url
        : typeof annotation.unsafeUrl === 'string'
          ? annotation.unsafeUrl
          : null;
    const subtype = annotation.subtype ?? annotation.annotationType;
    if (!url || (subtype !== 'Link' && subtype !== 2)) {
      continue;
    }

    if (!Array.isArray(annotation.rect) || annotation.rect.length < 4) {
      continue;
    }

    const rect = normalizeViewportRect(viewport, annotation.rect);
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    const label = normalizeLinkHotspotLabel(
      annotation.contents ?? annotation.title ?? annotation.altText ?? url,
    );

    hotspots.push({
      label,
      url,
      rect,
      isIndicoEvent: Boolean(parseIndicoEventUrl(url)),
    });
  }

  return hotspots;
};

const createLoadingPreviewState = (
  label: string,
  pageCount = 0,
  pageSizes: Array<{ width: number; height: number }> = [],
  pageStatuses: Array<'pending' | 'ready'> = [],
): Extract<PdfPreviewState, { kind: 'loading' }> => ({
  kind: 'loading',
  label,
  pageCount,
  pageSizes,
  pageStatuses,
});

const createErrorPreviewState = (
  label: string,
  pageCount = 0,
  pageSizes: Array<{ width: number; height: number }> = [],
  pageStatuses: Array<'pending' | 'ready'> = [],
): Extract<PdfPreviewState, { kind: 'error' }> => ({
  kind: 'error',
  label,
  pageCount,
  pageSizes,
  pageStatuses,
});

const createIdlePointerDiagnostics = (): PointerDiagnostics => ({
  eventKind: 'idle',
  pointerId: null,
  pointerType: 'none',
  button: 0,
  buttons: 0,
  pressure: 0,
  isPrimary: false,
  resolvedTool: 'unknown',
  latchedTool: null,
  renderedTool: 'unknown',
  interactionMode: 'none',
  cursor: getPointerCursor('unknown'),
  overlayClass: getPointerOverlayClass('unknown'),
});

const getPointerCursorForInteraction = (
  renderedTool: PointerTool,
  interactionMode: PointerInteractionMode,
) =>
  renderedTool === 'mouse' && interactionMode === 'pan'
    ? 'default'
    : getPointerCursor(renderedTool);

const getRenderedToolForInteraction = (
  resolvedTool: PointerTool,
  renderedTool: PointerTool,
  interactionMode: PointerInteractionMode,
) =>
  interactionMode === 'erase'
    ? 'eraser'
    : interactionMode === 'text'
      ? 'text'
      : resolvedTool === 'mouse'
        ? 'mouse'
        : renderedTool;

const toPointerSample = (
  event: React.PointerEvent<HTMLDivElement>,
): PointerSample => ({
  pointerType: event.pointerType,
  button: event.button,
  buttons: event.buttons,
  pressure: event.pressure,
  isPrimary: event.isPrimary,
});

const getPagePoint = (
  event: React.PointerEvent<HTMLElement>,
  bounds?: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): NormalizedPagePoint => {
  const pageBounds = bounds ?? event.currentTarget.getBoundingClientRect();

  return toNormalizedViewportPoint(
    {
      x: event.clientX,
      y: event.clientY,
      pressure: event.pressure,
      time: event.timeStamp,
    },
    pageBounds,
  );
};

export const getCoalescedPagePoints = (
  event: React.PointerEvent<HTMLElement>,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
) => {
  const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
  const pointerEvents = coalescedEvents.length
    ? coalescedEvents
    : [event.nativeEvent];

  return pointerEvents.map((pointerEvent) =>
    toNormalizedViewportPoint(
      {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        pressure: pointerEvent.pressure,
        time: pointerEvent.timeStamp,
      },
      bounds,
    ),
  );
};

export const getPredictedPagePoints = (
  event: React.PointerEvent<HTMLElement>,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
) =>
  (event.nativeEvent.getPredictedEvents?.() ?? []).map((pointerEvent) =>
    toNormalizedViewportPoint(
      {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        pressure: pointerEvent.pressure,
        time: pointerEvent.timeStamp,
      },
      bounds,
    ),
  );

const createStrokeId = () =>
  `stroke-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

const createTextNoteId = () =>
  `text-note-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const DEFAULT_TEXT_NOTE_WIDTH = 0.26;
const clampTextNoteWidth = (value: number) =>
  Math.max(0.12, Math.min(0.8, value));

const getScrollViewportElement = (
  scrollContainerRef?: React.RefObject<HTMLElement | null>,
) =>
  scrollContainerRef?.current ??
  document.querySelector<HTMLElement>('.page-surface') ??
  document.documentElement;

const getNearestScrollableAncestor = (target: EventTarget | null) => {
  let element = target instanceof HTMLElement ? target : null;
  while (element) {
    const style = window.getComputedStyle(element);
    if (
      /(auto|scroll|overlay)/.test(style.overflowY) ||
      /(auto|scroll|overlay)/.test(style.overflowX)
    ) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
};

const isEditableKeyboardTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT');

type MemoizedPdfPageFrameProps = {
  pageIndex: number;
  displayWidth: number;
  displayHeight: number;
  pageSize: { width: number; height: number };
  pageStrokes: InkStroke[];
  pageTextNotes: TextNote[];
  pageLinks: PdfLinkHotspot[];
  marker: PointerMarker | null;
  pageTextNoteDraft: TextNoteDraft | null;
  renderedTool: PointerTool;
  cursor: string;
  overlayClass: string;
  pageCanvasRefs: React.MutableRefObject<Array<HTMLCanvasElement | null>>;
  pageFigureRefs: React.MutableRefObject<Array<HTMLElement | null>>;
  handlePagePointerEvent: (
    pageIndex: number,
    eventKind: PointerEventKind,
  ) => React.PointerEventHandler<HTMLDivElement>;
  children: React.ReactNode;
};

const MemoizedPdfPageFrame = React.memo(
  (props: MemoizedPdfPageFrameProps) => (
    <figure
      className="pdf-preview-page"
      ref={(element) => {
        props.pageFigureRefs.current[props.pageIndex] = element;
      }}
      style={{
        width: `${props.displayWidth}px`,
        height: `${props.displayHeight}px`,
      }}
    >
      <div
        className="pdf-preview-sheet"
        data-rendered-tool={props.renderedTool}
        draggable={false}
        style={{
          cursor: props.cursor,
          width: `${props.displayWidth}px`,
          height: `${props.displayHeight}px`,
        }}
        onPointerMove={props.handlePagePointerEvent(
          props.pageIndex,
          'pointermove',
        )}
        onPointerDown={props.handlePagePointerEvent(
          props.pageIndex,
          'pointerdown',
        )}
        onPointerUp={props.handlePagePointerEvent(props.pageIndex, 'pointerup')}
        onPointerCancel={props.handlePagePointerEvent(
          props.pageIndex,
          'pointercancel',
        )}
      >
        {props.children}
      </div>
    </figure>
  ),
  (previous, next) =>
    previous.pageIndex === next.pageIndex &&
    previous.displayWidth === next.displayWidth &&
    previous.displayHeight === next.displayHeight &&
    previous.pageSize === next.pageSize &&
    previous.pageStrokes === next.pageStrokes &&
    previous.pageTextNotes === next.pageTextNotes &&
    previous.pageLinks === next.pageLinks &&
    previous.marker === next.marker &&
    previous.pageTextNoteDraft === next.pageTextNoteDraft &&
    previous.renderedTool === next.renderedTool &&
    previous.cursor === next.cursor &&
    previous.overlayClass === next.overlayClass &&
    previous.pageCanvasRefs === next.pageCanvasRefs &&
    previous.pageFigureRefs === next.pageFigureRefs &&
    previous.handlePagePointerEvent === next.handlePagePointerEvent,
);

type PdfPreviewProps = {
  filePath: string | null;
  blankPageMode?: boolean;
  workspaceSourceUrl?: string;
  readOnly?: boolean;
  workspaceMode?: 'slides' | 'notes';
  onWorkspaceModeChange?: (mode: 'slides' | 'notes') => void;
  title?: string;
  conferenceId?: string | null;
  talkId?: string | null;
  workspaceDeckId?: string | null;
  onOpenIndicoEvent?: (eventUrl: string) => Promise<void>;
  onBackToAgenda?: () => void;
  onRetryLoad?: () => void;
  onSlideMetricsChange?: (metrics: {
    currentSlideNumber: number;
    currentPageCount: number;
  }) => void;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  penThickness?: number;
  onPenThicknessChange?: (value: number) => void | Promise<void>;
  penColors?: string[];
};

export const PEN_POINTER_MARKER_RADIUS = 2.5;

export function PdfPreview({
  filePath,
  blankPageMode = false,
  workspaceSourceUrl,
  readOnly = false,
  workspaceMode,
  onWorkspaceModeChange,
  title,
  conferenceId = null,
  talkId = null,
  workspaceDeckId = null,
  onOpenIndicoEvent,
  onBackToAgenda,
  onRetryLoad,
  onSlideMetricsChange,
  scrollContainerRef,
  penThickness = DEFAULT_PEN_THICKNESS,
  onPenThicknessChange,
  penColors = [...DEFAULT_PEN_COLORS],
}: PdfPreviewProps) {
  const renderCountRef = React.useRef(0);
  renderCountRef.current += 1;
  const performanceRuntime = globalThis as typeof globalThis & {
    __indicoInkTrackPdfPreviewRenders?: boolean;
    __indicoInkPdfPreviewRenderCount?: number;
  };
  if (performanceRuntime.__indicoInkTrackPdfPreviewRenders) {
    performanceRuntime.__indicoInkPdfPreviewRenderCount =
      renderCountRef.current;
  }
  const [state, setState] = React.useState<PdfPreviewState>({ kind: 'idle' });
  const [manualTool, setManualTool] = React.useState<ManualTool>('pen');
  const [selectedPenColor, setSelectedPenColor] = React.useState(
    penColors[0] ?? DEFAULT_PEN_COLORS[0],
  );
  const [isPenColorMenuOpen, setIsPenColorMenuOpen] = React.useState(false);
  const penColorPickerRef = React.useRef<HTMLDivElement>(null);
  const [selectedPenThickness, setSelectedPenThickness] =
    React.useState(penThickness);
  React.useEffect(() => {
    setSelectedPenThickness(penThickness);
  }, [penThickness]);
  React.useEffect(() => {
    setSelectedPenColor((current) =>
      penColors.includes(current)
        ? current
        : (penColors[0] ?? DEFAULT_PEN_COLORS[0]),
    );
  }, [penColors]);
  React.useEffect(() => {
    if (!isPenColorMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!penColorPickerRef.current?.contains(event.target as Node)) {
        setIsPenColorMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPenColorMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPenColorMenuOpen]);
  const [pointerDiagnostics, setPointerDiagnostics] =
    React.useState<PointerDiagnostics>(createIdlePointerDiagnostics());
  const pageCanvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const dryInkCanvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const wetInkCanvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const predictedInkCanvasRefs = React.useRef<Array<HTMLCanvasElement | null>>(
    [],
  );
  const liveCommittedStrokeIdsRef = React.useRef(new Set<string>());
  const inkLayerCanvasRefs = React.useMemo<InkLayerCanvasRefs>(
    () => ({
      dry: dryInkCanvasRefs,
      wet: wetInkCanvasRefs,
      predicted: predictedInkCanvasRefs,
      liveCommittedStrokeIds: liveCommittedStrokeIdsRef,
    }),
    [],
  );
  const pdfPagesRef = React.useRef<HTMLDivElement | null>(null);
  const stageViewportRef = React.useRef<HTMLDivElement | null>(null);
  const latchedToolRef = React.useRef<PointerTool | null>(null);
  const activeInkActionRef = React.useRef<ActiveInkAction>(null);
  const touchPointersRef = React.useRef<Map<number, PdfZoomPoint>>(new Map());
  const touchScrollContainerRef = React.useRef<HTMLElement | null>(null);
  const touchPanSamplesRef = React.useRef<TouchPanSample[]>([]);
  const touchMomentumFrameRef = React.useRef<number | null>(null);
  const pinchGestureRef = React.useRef<PinchGesture | null>(null);
  const [strokesByPage, setStrokesByPage] = React.useState<Array<InkStroke[]>>(
    [],
  );
  const [textNotesByPage, setTextNotesByPage] = React.useState<
    Array<TextNote[]>
  >([]);
  const [history, setHistory] = React.useState<PdfWorkspaceHistory>(
    createWorkspaceHistory,
  );
  const strokesByPageRef = React.useRef(strokesByPage);
  const textNotesByPageRef = React.useRef(textNotesByPage);
  const historyRef = React.useRef(history);
  const [textNoteDraft, setTextNoteDraft] =
    React.useState<TextNoteDraft | null>(null);
  const [textNoteDragState, setTextNoteDragState] =
    React.useState<TextNoteDragState | null>(null);
  const [textNoteResizeState, setTextNoteResizeState] =
    React.useState<TextNoteResizeState | null>(null);
  const textNoteResizeStateRef = React.useRef<TextNoteResizeState | null>(null);
  const [pointerMarker, setPointerMarker] =
    React.useState<PointerMarker | null>(null);
  const [linkHotspotsByPage, setLinkHotspotsByPage] = React.useState<
    Array<PdfLinkHotspot[]>
  >([]);
  const [activeLinkPopover, setActiveLinkPopover] =
    React.useState<LinkPopoverState>(null);
  const [copyTooltip, setCopyTooltip] = React.useState<CopyTooltipState>(null);

  React.useEffect(() => {
    setSelectedPenThickness(penThickness);
  }, [penThickness]);
  React.useEffect(() => {
    strokesByPageRef.current = strokesByPage;
  }, [strokesByPage]);
  React.useEffect(() => {
    textNotesByPageRef.current = textNotesByPage;
  }, [textNotesByPage]);
  React.useEffect(() => {
    historyRef.current = history;
  }, [history]);
  const [persistenceError, setPersistenceError] = React.useState<string | null>(
    null,
  );
  const pointerDiagnosticsFrameRef = React.useRef<number | null>(null);
  const pendingPointerDiagnosticsRef = React.useRef<PointerDiagnostics | null>(
    null,
  );
  const pointerDiagnosticsRef = React.useRef(pointerDiagnostics);
  const activePageBoundsRef = React.useRef<{
    pointerId: number;
    pageIndex: number;
    bounds: DOMRect;
  } | null>(null);
  const strokeSegmentCacheRef = React.useRef(createStrokeSegmentCache());
  const activeInkFrameRef = React.useRef<number | null>(null);
  const predictedPointsRef = React.useRef<NormalizedPagePoint[]>([]);
  const persistenceSaveTimerRef = React.useRef<number | null>(null);
  const persistenceCheckpointTimerRef = React.useRef<number | null>(null);
  const persistenceSaveInFlightRef = React.useRef(false);
  const persistenceTrailingSaveRef = React.useRef(false);
  const persistenceRevisionRef = React.useRef(0);
  const persistedWorkspacePagesRef = React.useRef<WorkspacePages>({
    strokesByPage: [],
    textNotesByPage: [],
  });
  const flushPersistenceSaveRef = React.useRef<() => Promise<void>>(
    async () => undefined,
  );
  const textNoteEditorRef = React.useRef<HTMLTextAreaElement | null>(null);
  const persistenceHydratedRef = React.useRef(false);
  const workspaceSourceKeyRef = React.useRef<string | null>(null);
  const linkPopoverHideTimerRef = React.useRef<number | null>(null);
  const copyTooltipHideTimerRef = React.useRef<number | null>(null);
  const pendingWorkspaceRestoreRef = React.useRef<PdfWorkspaceSnapshot | null>(
    null,
  );
  const pendingLayoutRestoreRef = React.useRef<{
    scrollLeft: number;
    scrollTop: number;
    currentSlideNumber: number;
  } | null>(null);
  const pendingViewportRestoreRef = React.useRef<
    | {
        mode: 'anchor' | 'preserve-scroll';
        pageIndex: number;
        pageOffsetRatio: number;
        scrollLeft: number;
        scrollTop: number;
      }
    | (PdfZoomFocalAnchor & {
        mode: 'focal';
        preserveHorizontalScroll?: boolean;
      })
    | null
  >(null);
  const currentSlideNumberRef = React.useRef(1);
  const pageFigureRefs = React.useRef<Array<HTMLElement | null>>([]);
  const [zoomLevel, setZoomLevel] = React.useState(1);
  const zoomLevelRef = React.useRef(zoomLevel);
  const [pinchPreviewZoom, setPinchPreviewZoom] = React.useState<number | null>(
    null,
  );
  const [previewViewportWidth, setPreviewViewportWidth] = React.useState(0);
  const [currentSlideNumber, setCurrentSlideNumber] = React.useState(1);
  const [isNavigatorCollapsed, setIsNavigatorCollapsed] = React.useState(true);

  const clearLinkPopoverHideTimer = React.useCallback(() => {
    if (linkPopoverHideTimerRef.current !== null) {
      window.clearTimeout(linkPopoverHideTimerRef.current);
      linkPopoverHideTimerRef.current = null;
    }
  }, []);

  const hideLinkPopoverSoon = React.useCallback(() => {
    clearLinkPopoverHideTimer();
    linkPopoverHideTimerRef.current = window.setTimeout(() => {
      setActiveLinkPopover(null);
      linkPopoverHideTimerRef.current = null;
    }, 160);
  }, [clearLinkPopoverHideTimer]);

  const hideLinkPopoverOnPointerLeave = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') {
        return;
      }
      hideLinkPopoverSoon();
    },
    [hideLinkPopoverSoon],
  );

  const showLinkPopover = React.useCallback(
    (pageIndex: number, link: PdfLinkHotspot, x: number, y: number) => {
      clearLinkPopoverHideTimer();
      setActiveLinkPopover({
        pageIndex,
        link,
        x,
        y,
      });
    },
    [clearLinkPopoverHideTimer],
  );

  React.useEffect(() => {
    if (!activeLinkPopover) {
      return;
    }

    const dismissTouchPopoverOutside = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (
        target.closest('.pdf-preview-link-hotspot') ||
        target.closest('.pdf-preview-link-popover')
      ) {
        return;
      }

      clearLinkPopoverHideTimer();
      setActiveLinkPopover(null);
    };

    document.addEventListener('pointerdown', dismissTouchPopoverOutside, true);
    return () => {
      document.removeEventListener(
        'pointerdown',
        dismissTouchPopoverOutside,
        true,
      );
    };
  }, [activeLinkPopover, clearLinkPopoverHideTimer]);

  const captureViewportAnchor = React.useCallback(() => {
    const scrollContainer = getScrollViewportElement(scrollContainerRef);
    const pageFigures = pageFigureRefs.current;
    if (!scrollContainer || pageFigures.length === 0) {
      return null;
    }

    const scrollContainerBox = scrollContainer.getBoundingClientRect();
    const visibleTop = scrollContainer.scrollTop;
    let anchoredPageIndex = -1;
    let anchoredPageTop = 0;
    let anchoredPageHeight = 1;

    for (let index = 0; index < pageFigures.length; index += 1) {
      const pageFigure = pageFigures[index];
      if (!pageFigure) {
        continue;
      }

      const pageBox = pageFigure.getBoundingClientRect();
      const pageTop =
        pageBox.top - scrollContainerBox.top + scrollContainer.scrollTop;
      const pageBottom = pageTop + pageBox.height;

      if (pageTop <= visibleTop && pageBottom > visibleTop) {
        anchoredPageIndex = index;
        anchoredPageTop = pageTop;
        anchoredPageHeight = Math.max(1, pageBox.height);
        break;
      }

      if (pageTop <= visibleTop) {
        anchoredPageIndex = index;
        anchoredPageTop = pageTop;
        anchoredPageHeight = Math.max(1, pageBox.height);
        continue;
      }

      if (anchoredPageIndex === -1) {
        anchoredPageIndex = index;
        anchoredPageTop = pageTop;
        anchoredPageHeight = Math.max(1, pageBox.height);
      }

      break;
    }

    if (anchoredPageIndex < 0) {
      return null;
    }

    return {
      pageIndex: anchoredPageIndex,
      pageOffsetRatio: clamp01(
        (scrollContainer.scrollTop - anchoredPageTop) / anchoredPageHeight,
      ),
      scrollLeft: scrollContainer.scrollLeft,
      scrollTop: scrollContainer.scrollTop,
    };
  }, [scrollContainerRef]);

  const captureFocalViewportAnchor = React.useCallback(
    (midpoint: PdfZoomPoint): PdfZoomFocalAnchor | null => {
      const scrollContainer = getScrollViewportElement(scrollContainerRef);
      if (!scrollContainer) {
        return null;
      }

      let closestDistance = Number.POSITIVE_INFINITY;
      let pageIndex = -1;

      pageFigureRefs.current.forEach((pageFigure, index) => {
        if (!pageFigure) {
          return;
        }

        const pageBox = pageFigure.getBoundingClientRect();
        const distance =
          midpoint.y < pageBox.top
            ? pageBox.top - midpoint.y
            : midpoint.y > pageBox.bottom
              ? midpoint.y - pageBox.bottom
              : 0;

        if (distance < closestDistance) {
          closestDistance = distance;
          pageIndex = index;
        }
      });

      const anchoredPage =
        pageIndex >= 0 ? pageFigureRefs.current[pageIndex] : null;
      if (!anchoredPage) {
        return null;
      }

      const pageBox = anchoredPage.getBoundingClientRect();
      return {
        pageIndex,
        pageOffsetXRatio: clamp01(
          (midpoint.x - pageBox.left) / Math.max(1, pageBox.width),
        ),
        pageOffsetYRatio: clamp01(
          (midpoint.y - pageBox.top) / Math.max(1, pageBox.height),
        ),
        midpoint,
        scrollLeft: scrollContainer.scrollLeft,
        scrollTop: scrollContainer.scrollTop,
      };
    },
    [scrollContainerRef],
  );

  const restoreFocalViewport = React.useCallback(
    (anchor: PdfZoomFocalAnchor): boolean => {
      const scrollContainer = getScrollViewportElement(scrollContainerRef);
      const pageFigure = pageFigureRefs.current[anchor.pageIndex];
      if (!scrollContainer || !pageFigure) {
        return false;
      }

      const scrollContainerBox = scrollContainer.getBoundingClientRect();
      const pageFigureBox = pageFigure.getBoundingClientRect();
      const nextScrollPosition = getFocalScrollPosition({
        pageLeft: pageFigureBox.left,
        pageTop: pageFigureBox.top,
        pageWidth: pageFigureBox.width,
        pageHeight: pageFigureBox.height,
        pageOffsetXRatio: anchor.pageOffsetXRatio,
        pageOffsetYRatio: anchor.pageOffsetYRatio,
        midpoint: anchor.midpoint,
        viewportLeft: scrollContainerBox.left,
        viewportTop: scrollContainerBox.top,
        scrollLeft: scrollContainer.scrollLeft,
        scrollTop: scrollContainer.scrollTop,
      });
      scrollContainer.scrollLeft = nextScrollPosition.left;
      scrollContainer.scrollTop = nextScrollPosition.top;
      return true;
    },
    [scrollContainerRef],
  );

  React.useEffect(() => {
    const stageElement = stageViewportRef.current;
    if (!stageElement) {
      return;
    }

    const updateWidth = () => {
      const style = window.getComputedStyle(stageElement);
      const horizontalPadding =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const nextWidth = Math.max(
        0,
        Math.floor(stageElement.clientWidth - horizontalPadding),
      );
      setPreviewViewportWidth((currentWidth) => {
        if (
          currentWidth !== nextWidth &&
          currentWidth > 0 &&
          pendingViewportRestoreRef.current?.mode !== 'focal'
        ) {
          const anchor = captureViewportAnchor();
          const scrollContainer = scrollContainerRef?.current ?? stageElement;
          pendingViewportRestoreRef.current =
            nextWidth > currentWidth
              ? {
                  mode: 'preserve-scroll',
                  pageIndex: Math.max(0, currentSlideNumberRef.current - 1),
                  pageOffsetRatio: 0,
                  scrollLeft: scrollContainer.scrollLeft,
                  scrollTop: scrollContainer.scrollTop,
                }
              : anchor
                ? {
                    mode: 'anchor',
                    ...anchor,
                  }
                : null;
        }

        return currentWidth === nextWidth ? currentWidth : nextWidth;
      });
    };

    updateWidth();
    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(stageElement);

    return () => {
      observer.disconnect();
    };
  }, [captureViewportAnchor, scrollContainerRef]);

  const resolvePointerInteraction = React.useCallback(
    (
      eventKind: PointerEventKind,
      event: React.PointerEvent<HTMLDivElement>,
    ): PointerInteractionResolution => {
      const sample = toPointerSample(event);
      const toolState = createPointerToolState(
        sample,
        eventKind,
        latchedToolRef.current,
      );
      const manualInteractionMode =
        manualTool === 'text'
          ? 'text'
          : manualTool === 'eraser'
            ? 'erase'
            : 'draw';

      const interactionMode = readOnly
        ? 'pan'
        : toolState.renderedTool === 'touch'
          ? manualTool === 'text'
            ? 'text'
            : 'pan'
          : manualTool === 'text'
            ? 'text'
            : toolState.renderedTool === 'mouse'
              ? manualInteractionMode
              : toolState.renderedTool === 'pen'
                ? manualInteractionMode
                : getPointerInteractionMode(toolState.renderedTool);

      return {
        sample,
        toolState,
        interactionMode,
        renderedTool: getRenderedToolForInteraction(
          toolState.resolvedTool,
          toolState.renderedTool,
          interactionMode,
        ),
      };
    },
    [manualTool, readOnly],
  );

  const flushPointerDiagnostics = React.useCallback(() => {
    if (pointerDiagnosticsFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerDiagnosticsFrameRef.current);
      pointerDiagnosticsFrameRef.current = null;
    }

    const pending = pendingPointerDiagnosticsRef.current;
    if (pending) {
      pendingPointerDiagnosticsRef.current = null;
      setPointerDiagnostics(pending);
    }
  }, []);

  const schedulePointerDiagnostics = React.useCallback(
    (nextPointerDiagnostics: PointerDiagnostics) => {
      pendingPointerDiagnosticsRef.current = nextPointerDiagnostics;

      if (pointerDiagnosticsFrameRef.current !== null) {
        return;
      }

      pointerDiagnosticsFrameRef.current = window.requestAnimationFrame(() => {
        pointerDiagnosticsFrameRef.current = null;
        const pending = pendingPointerDiagnosticsRef.current;
        if (!pending) {
          return;
        }

        pendingPointerDiagnosticsRef.current = null;
        setPointerDiagnostics(pending);
      });
    },
    [],
  );

  React.useEffect(
    () => () => {
      if (pointerDiagnosticsFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerDiagnosticsFrameRef.current);
        pointerDiagnosticsFrameRef.current = null;
      }
      clearLinkPopoverHideTimer();
      if (copyTooltipHideTimerRef.current !== null) {
        window.clearTimeout(copyTooltipHideTimerRef.current);
        copyTooltipHideTimerRef.current = null;
      }
    },
    [clearLinkPopoverHideTimer],
  );

  const updatePointerDiagnostics = React.useCallback(
    (
      eventKind: PointerEventKind,
      event: React.PointerEvent<HTMLDivElement>,
      resolution: PointerInteractionResolution,
    ) => {
      const { sample, toolState, interactionMode, renderedTool } = resolution;

      latchedToolRef.current = toolState.latchedTool;
      const nextPointerDiagnostics: PointerDiagnostics = {
        eventKind,
        pointerId: event.pointerId,
        pointerType: sample.pointerType,
        button: sample.button,
        buttons: sample.buttons,
        pressure: sample.pressure,
        isPrimary: sample.isPrimary,
        resolvedTool: toolState.resolvedTool,
        latchedTool: toolState.latchedTool,
        renderedTool,
        interactionMode,
        cursor: getPointerCursorForInteraction(renderedTool, interactionMode),
        overlayClass: getPointerOverlayClass(renderedTool),
      };
      const currentDiagnostics =
        pendingPointerDiagnosticsRef.current ?? pointerDiagnosticsRef.current;
      if (
        eventKind === 'pointermove' &&
        currentDiagnostics.renderedTool ===
          nextPointerDiagnostics.renderedTool &&
        currentDiagnostics.interactionMode ===
          nextPointerDiagnostics.interactionMode &&
        currentDiagnostics.cursor === nextPointerDiagnostics.cursor &&
        currentDiagnostics.overlayClass === nextPointerDiagnostics.overlayClass
      ) {
        return;
      }
      if (
        eventKind === 'pointerdown' ||
        eventKind === 'pointerup' ||
        eventKind === 'pointercancel'
      ) {
        flushPointerDiagnostics();
        setPointerDiagnostics(nextPointerDiagnostics);
        return;
      }

      schedulePointerDiagnostics(nextPointerDiagnostics);
    },
    [flushPointerDiagnostics, schedulePointerDiagnostics],
  );

  React.useEffect(() => {
    pointerDiagnosticsRef.current = pointerDiagnostics;
  }, [pointerDiagnostics]);

  const handlePointerEvent = React.useCallback(
    (eventKind: PointerEventKind) =>
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (eventKind === 'pointerdown') {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }

        const resolution = resolvePointerInteraction(eventKind, event);
        updatePointerDiagnostics(eventKind, event, resolution);

        if (eventKind === 'pointerup' || eventKind === 'pointercancel') {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }
        return resolution;
      },
    [resolvePointerInteraction, updatePointerDiagnostics],
  );

  const updateStrokePage = React.useCallback(
    (
      pageIndex: number,
      updater: (currentStrokes: InkStroke[]) => InkStroke[],
    ) => {
      setStrokesByPage((currentPages) => {
        const nextPages = currentPages.map((pageStrokes, currentIndex) =>
          currentIndex === pageIndex ? updater(pageStrokes) : pageStrokes,
        );
        strokesByPageRef.current = nextPages;
        return nextPages;
      });
    },
    [],
  );

  const updateTextNotePage = React.useCallback(
    (
      pageIndex: number,
      updater: (currentTextNotes: TextNote[]) => TextNote[],
    ) => {
      setTextNotesByPage((currentPages) => {
        const nextPages = currentPages.map((pageTextNotes, currentIndex) =>
          currentIndex === pageIndex ? updater(pageTextNotes) : pageTextNotes,
        );
        textNotesByPageRef.current = nextPages;
        return nextPages;
      });
    },
    [],
  );

  const setWorkspacePages = React.useCallback((pages: WorkspacePages) => {
    strokesByPageRef.current = pages.strokesByPage;
    textNotesByPageRef.current = pages.textNotesByPage;
    setStrokesByPage(pages.strokesByPage);
    setTextNotesByPage(pages.textNotesByPage);
  }, []);

  const recordWorkspaceChange = React.useCallback(
    (before: WorkspacePages, after: WorkspacePages) => {
      const entry = createWorkspaceHistoryEntry(before, after);
      if (!entry) {
        return;
      }
      const nextHistory = pushWorkspaceHistory(historyRef.current, entry);
      historyRef.current = nextHistory;
      setHistory(nextHistory);
    },
    [],
  );

  const handleUndo = React.useCallback(() => {
    const result = undoWorkspaceHistory(
      {
        strokesByPage: strokesByPageRef.current,
        textNotesByPage: textNotesByPageRef.current,
      },
      historyRef.current,
    );
    if (!result) {
      return;
    }

    historyRef.current = result.history;
    setHistory(result.history);
    setWorkspacePages(result.pages);
  }, [setWorkspacePages]);

  const handleRedo = React.useCallback(() => {
    const result = redoWorkspaceHistory(
      {
        strokesByPage: strokesByPageRef.current,
        textNotesByPage: textNotesByPageRef.current,
      },
      historyRef.current,
    );
    if (!result) {
      return;
    }

    historyRef.current = result.history;
    setHistory(result.history);
    setWorkspacePages(result.pages);
  }, [setWorkspacePages]);

  const currentPageCount =
    state.kind === 'loading' || state.kind === 'ready' || state.kind === 'error'
      ? state.pageCount
      : 0;
  const persistedPageCount = blankPageMode
    ? Math.max(
        0,
        currentPageCount -
          (strokesByPage[currentPageCount - 1]?.length ||
          textNotesByPage[currentPageCount - 1]?.length
            ? 0
            : 1),
      )
    : currentPageCount;

  React.useEffect(() => {
    if (!blankPageMode || state.kind !== 'ready' || currentPageCount === 0) {
      return;
    }

    const lastPageIndex = currentPageCount - 1;
    const lastPageHasContent =
      (strokesByPage[lastPageIndex]?.length ?? 0) > 0 ||
      (textNotesByPage[lastPageIndex]?.length ?? 0) > 0;
    if (!lastPageHasContent) {
      return;
    }

    const nextPageCount = currentPageCount + 1;
    const nextStrokes = [...strokesByPageRef.current, [] as InkStroke[]];
    const nextTextNotes = [...textNotesByPageRef.current, [] as TextNote[]];
    strokesByPageRef.current = nextStrokes;
    textNotesByPageRef.current = nextTextNotes;
    setStrokesByPage(nextStrokes);
    setTextNotesByPage(nextTextNotes);
    setState((currentState) => {
      if (
        currentState.kind !== 'ready' ||
        currentState.pageCount !== currentPageCount
      ) {
        return currentState;
      }
      return {
        ...currentState,
        pageCount: nextPageCount,
        pageSizes: [...currentState.pageSizes, { width: 800, height: 1100 }],
        pageStatuses: [...currentState.pageStatuses, 'ready'],
      };
    });
  }, [
    blankPageMode,
    currentPageCount,
    state.kind,
    strokesByPage,
    textNotesByPage,
  ]);
  const readyPageStatuses =
    state.kind === 'ready' ? state.pageStatuses : undefined;
  const isRefreshingRenderedPages =
    state.kind === 'loading' &&
    state.pageCount > 0 &&
    state.pageStatuses.every((pageStatus) => pageStatus === 'ready');
  const renderablePageSizes =
    state.kind === 'loading' || state.kind === 'ready' || state.kind === 'error'
      ? state.pageSizes
      : [];
  const displayZoomLevel = pinchPreviewZoom ?? zoomLevel;

  const closeTextNoteDraft = React.useCallback(() => {
    setTextNoteDraft(null);
    setTextNoteDragState(null);
    activeInkActionRef.current = null;
  }, []);

  const commitTextNoteDraft = React.useCallback(() => {
    if (!textNoteDraft) {
      return;
    }

    const trimmedText = textNoteDraft.text.trim();
    if (!trimmedText) {
      closeTextNoteDraft();
      return;
    }

    const now = Date.now();
    const noteId = textNoteDraft.noteId ?? createTextNoteId();
    const effectiveConferenceId =
      conferenceId ?? createConferenceId(filePath ?? 'local-pdf');
    const effectiveTalkId =
      talkId ?? createTalkId(effectiveConferenceId, filePath ?? 'local-pdf');
    const effectiveDeckId =
      workspaceDeckId ?? createDeckId(effectiveTalkId, filePath ?? 'local-pdf');
    const nextNote: TextNote = {
      id: noteId,
      conferenceId: effectiveConferenceId,
      talkId: effectiveTalkId,
      deckId: effectiveDeckId,
      slideId: createSlideId(effectiveDeckId, textNoteDraft.pageIndex + 1),
      x: clamp01(textNoteDraft.x),
      y: clamp01(textNoteDraft.y),
      width: clampTextNoteWidth(textNoteDraft.width),
      text: trimmedText,
      createdAt: now,
      updatedAt: now,
    };

    const currentTextNotesByPage = textNotesByPageRef.current;
    const nextTextNotesByPage = currentTextNotesByPage.length
      ? currentTextNotesByPage.map((pageNotes, pageIndex) => {
          if (pageIndex !== textNoteDraft.pageIndex) {
            return pageNotes;
          }

          if (textNoteDraft.mode === 'edit') {
            return [
              ...pageNotes.filter((note) => note.id !== noteId),
              nextNote,
            ];
          }

          return pageNotes.some((note) => note.id === noteId)
            ? pageNotes.map((note) => (note.id === noteId ? nextNote : note))
            : [...pageNotes, nextNote];
        })
      : createEmptyTextNotePages(currentPageCount).map(
          (pageNotes, pageIndex) =>
            pageIndex === textNoteDraft.pageIndex ? [nextNote] : pageNotes,
        );

    const before = {
      strokesByPage: strokesByPageRef.current,
      textNotesByPage: currentTextNotesByPage,
    };
    const after = {
      strokesByPage: strokesByPageRef.current,
      textNotesByPage: nextTextNotesByPage,
    };
    textNotesByPageRef.current = nextTextNotesByPage;
    setTextNotesByPage(nextTextNotesByPage);
    recordWorkspaceChange(before, after);

    closeTextNoteDraft();
  }, [
    closeTextNoteDraft,
    conferenceId,
    currentPageCount,
    filePath,
    recordWorkspaceChange,
    talkId,
    textNoteDraft,
    workspaceDeckId,
  ]);

  const handleDeleteTextNote = React.useCallback(
    (pageIndex: number, noteId: string) => {
      const before = {
        strokesByPage: strokesByPageRef.current,
        textNotesByPage: textNotesByPageRef.current,
      };
      const nextTextNotesByPage = textNotesByPageRef.current.map(
        (notes, index) =>
          index === pageIndex
            ? notes.filter((note) => note.id !== noteId)
            : notes,
      );
      textNotesByPageRef.current = nextTextNotesByPage;
      setTextNotesByPage(nextTextNotesByPage);
      recordWorkspaceChange(before, {
        strokesByPage: strokesByPageRef.current,
        textNotesByPage: nextTextNotesByPage,
      });
      if (textNoteDraft?.noteId === noteId) {
        closeTextNoteDraft();
      }
    },
    [closeTextNoteDraft, recordWorkspaceChange, textNoteDraft],
  );

  const handleEditTextNote = React.useCallback(
    (pageIndex: number, note: TextNote) => {
      setTextNoteDraft({
        mode: 'edit',
        noteId: note.id,
        pageIndex,
        x: note.x,
        y: note.y,
        width: clampTextNoteWidth(note.width ?? DEFAULT_TEXT_NOTE_WIDTH),
        text: note.text,
      });
    },
    [],
  );

  const handleTextNoteEditorKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTextNoteDraft();
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitTextNoteDraft();
      }
    },
    [closeTextNoteDraft, commitTextNoteDraft],
  );

  const focusTextNoteEditor = React.useCallback(
    (element: HTMLTextAreaElement | null) => {
      textNoteEditorRef.current = element;
      if (element) {
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
      }
    },
    [],
  );

  const handleTextNoteDragStart = React.useCallback(
    (
      pageIndex: number,
      note: TextNote,
      event: React.PointerEvent<HTMLButtonElement>,
    ) => {
      const noteElement = event.currentTarget.closest<HTMLElement>(
        '.pdf-preview-text-note',
      );
      const noteRect = noteElement?.getBoundingClientRect();
      if (!noteRect) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setTextNoteDragState({
        pointerId: event.pointerId,
        noteId: note.id,
        pageIndex,
        startOffsetX: event.clientX - noteRect.left,
        startOffsetY: event.clientY - noteRect.top,
        beforeNote: { ...note },
      });
    },
    [],
  );

  const handleTextNoteResizeStart = React.useCallback(
    (pageIndex: number, event: React.PointerEvent<HTMLButtonElement>) => {
      if (!textNoteDraft) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const nextResizeState = {
        pointerId: event.pointerId,
        pageIndex,
        startClientX: event.clientX,
        startWidth: textNoteDraft.width,
      };
      textNoteResizeStateRef.current = nextResizeState;
      setTextNoteResizeState(nextResizeState);
    },
    [textNoteDraft],
  );

  const handleTextNoteResizePointerEvent = React.useCallback(
    (
      pageIndex: number,
      eventKind: 'pointermove' | 'pointerup' | 'pointercancel',
      event: React.PointerEvent<HTMLButtonElement>,
    ) => {
      const resizeState = textNoteResizeStateRef.current;
      if (
        !resizeState ||
        resizeState.pointerId !== event.pointerId ||
        resizeState.pageIndex !== pageIndex
      ) {
        return;
      }

      if (eventKind === 'pointermove') {
        const pageWidth = event.currentTarget
          .closest<HTMLElement>('.pdf-preview-sheet')
          ?.getBoundingClientRect().width;
        if (pageWidth && pageWidth > 0) {
          setTextNoteDraft((currentDraft) =>
            currentDraft
              ? {
                  ...currentDraft,
                  width: clampTextNoteWidth(
                    resizeState.startWidth +
                      (event.clientX - resizeState.startClientX) / pageWidth,
                  ),
                }
              : currentDraft,
          );
        }
      } else {
        textNoteResizeStateRef.current = null;
        setTextNoteResizeState(null);
      }

      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const getDefaultZoomMidpoint = React.useCallback((): PdfZoomPoint => {
    const scrollContainer = getScrollViewportElement(scrollContainerRef);
    const viewport = scrollContainer.getBoundingClientRect();
    return {
      x: viewport.left + viewport.width / 2,
      y: viewport.top + viewport.height / 2,
    };
  }, [scrollContainerRef]);

  const setZoomAtPoint = React.useCallback(
    (
      nextZoom: number,
      midpoint: PdfZoomPoint,
      preserveHorizontalScroll = false,
    ) => {
      const clampedZoom = clampPdfZoom(nextZoom);
      const currentZoom = zoomLevelRef.current;
      if (clampedZoom === currentZoom) {
        return;
      }

      pendingWorkspaceRestoreRef.current = null;
      pendingLayoutRestoreRef.current = null;
      persistenceHydratedRef.current = true;
      const anchor = captureFocalViewportAnchor(midpoint);
      if (anchor) {
        pendingViewportRestoreRef.current = {
          mode: 'focal',
          ...anchor,
          preserveHorizontalScroll,
        };
      }

      zoomLevelRef.current = clampedZoom;
      setZoomLevel(clampedZoom);
    },
    [captureFocalViewportAnchor],
  );

  const handleZoomIn = React.useCallback(
    (midpoint?: PdfZoomPoint) => {
      setZoomAtPoint(
        zoomLevelRef.current + PDF_ZOOM_STEP,
        midpoint ?? getDefaultZoomMidpoint(),
        midpoint === undefined,
      );
    },
    [getDefaultZoomMidpoint, setZoomAtPoint],
  );

  const handleZoomOut = React.useCallback(
    (midpoint?: PdfZoomPoint) => {
      setZoomAtPoint(
        zoomLevelRef.current - PDF_ZOOM_STEP,
        midpoint ?? getDefaultZoomMidpoint(),
        midpoint === undefined,
      );
    },
    [getDefaultZoomMidpoint, setZoomAtPoint],
  );

  const cancelTouchMomentum = React.useCallback(() => {
    if (touchMomentumFrameRef.current !== null) {
      window.cancelAnimationFrame(touchMomentumFrameRef.current);
      touchMomentumFrameRef.current = null;
    }
  }, []);

  const startTouchMomentum = React.useCallback(
    (initialVelocity: TouchMomentumVelocity) => {
      cancelTouchMomentum();
      if (
        Math.abs(initialVelocity.x) < 0.01 &&
        Math.abs(initialVelocity.y) < 0.01
      ) {
        return;
      }

      let position = { x: 0, y: 0 };
      const scrollContainer =
        touchScrollContainerRef.current ??
        getScrollViewportElement(scrollContainerRef);
      if (!scrollContainer) {
        return;
      }
      position = {
        x: scrollContainer.scrollLeft,
        y: scrollContainer.scrollTop,
      };
      let velocity = initialVelocity;
      let lastTimestamp: number | null = null;

      const animate = (timestamp: number) => {
        const currentScrollContainer =
          touchScrollContainerRef.current ??
          getScrollViewportElement(scrollContainerRef);
        if (!currentScrollContainer) {
          touchMomentumFrameRef.current = null;
          return;
        }

        const elapsedMs =
          lastTimestamp === null
            ? 16
            : Math.min(50, Math.max(1, timestamp - lastTimestamp));
        lastTimestamp = timestamp;
        const step = advanceTouchMomentum(position, velocity, elapsedMs, {
          maxX:
            currentScrollContainer.scrollWidth -
            currentScrollContainer.clientWidth,
          maxY:
            currentScrollContainer.scrollHeight -
            currentScrollContainer.clientHeight,
        });
        position = step.position;
        velocity = step.velocity;
        currentScrollContainer.scrollLeft = position.x;
        currentScrollContainer.scrollTop = position.y;

        if (step.isActive) {
          touchMomentumFrameRef.current = window.requestAnimationFrame(animate);
        } else {
          touchMomentumFrameRef.current = null;
        }
      };

      touchMomentumFrameRef.current = window.requestAnimationFrame(animate);
    },
    [cancelTouchMomentum, scrollContainerRef],
  );

  const beginPinchGesture = React.useCallback(
    (first: PdfZoomPoint, second: PdfZoomPoint) => {
      cancelTouchMomentum();
      const initialDistance = getPinchDistance(first, second);
      if (initialDistance <= 0) {
        return;
      }

      const midpoint = getPinchMidpoint(first, second);
      const anchor = captureFocalViewportAnchor(midpoint);
      const pagesElement = pdfPagesRef.current;
      const pagesBox = pagesElement?.getBoundingClientRect();
      const anchoredPage = anchor
        ? pageFigureRefs.current[anchor.pageIndex]
        : null;
      const anchoredPageBox = anchoredPage?.getBoundingClientRect();
      const origin =
        pagesBox && anchoredPageBox && anchor
          ? {
              x:
                anchoredPageBox.left +
                anchor.pageOffsetXRatio * anchoredPageBox.width -
                pagesBox.left,
              y:
                anchoredPageBox.top +
                anchor.pageOffsetYRatio * anchoredPageBox.height -
                pagesBox.top,
            }
          : pagesBox
            ? {
                x: midpoint.x - pagesBox.left,
                y: midpoint.y - pagesBox.top,
              }
            : { x: 0, y: 0 };

      pendingWorkspaceRestoreRef.current = null;
      pendingLayoutRestoreRef.current = null;
      pendingViewportRestoreRef.current = null;
      persistenceHydratedRef.current = true;
      pinchGestureRef.current = {
        initialDistance,
        initialZoom: zoomLevelRef.current,
        initialMidpoint: midpoint,
        origin,
        anchor,
      };
      setPinchPreviewZoom(zoomLevelRef.current);
      if (pagesElement) {
        pagesElement.style.transformOrigin = `${origin.x}px ${origin.y}px`;
        pagesElement.style.transform = 'none';
        pagesElement.style.willChange = 'transform';
      }
      activeInkActionRef.current = null;
    },
    [cancelTouchMomentum, captureFocalViewportAnchor],
  );

  const updatePinchGesture = React.useCallback(() => {
    const pinchGesture = pinchGestureRef.current;
    const pointers = Array.from(touchPointersRef.current.values());
    const [first, second] = pointers;
    if (!pinchGesture || !first || !second) {
      return;
    }

    const midpoint = getPinchMidpoint(first, second);
    const nextZoom = Number(
      getPinchZoom(
        pinchGesture.initialZoom,
        pinchGesture.initialDistance,
        getPinchDistance(first, second),
      ).toFixed(2),
    );

    const pagesElement = pdfPagesRef.current;
    if (pagesElement) {
      const scale = nextZoom / pinchGesture.initialZoom;
      const translateX = midpoint.x - pinchGesture.initialMidpoint.x;
      const translateY = midpoint.y - pinchGesture.initialMidpoint.y;
      pagesElement.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }
    setPinchPreviewZoom(nextZoom);
  }, []);

  const commitPinchGesture = React.useCallback(() => {
    const pinchGesture = pinchGestureRef.current;
    const pointers = Array.from(touchPointersRef.current.values());
    const [first, second] = pointers;
    const pagesElement = pdfPagesRef.current;
    if (pagesElement) {
      pagesElement.style.transform = '';
      pagesElement.style.transformOrigin = '';
      pagesElement.style.willChange = '';
    }

    setPinchPreviewZoom(null);
    if (!pinchGesture || !first || !second) {
      pinchGestureRef.current = null;
      return;
    }

    const nextZoom = Number(
      getPinchZoom(
        pinchGesture.initialZoom,
        pinchGesture.initialDistance,
        getPinchDistance(first, second),
      ).toFixed(2),
    );
    const midpoint = getPinchMidpoint(first, second);
    const viewportRestore = pinchGesture.anchor
      ? {
          mode: 'focal' as const,
          ...pinchGesture.anchor,
          midpoint,
        }
      : null;
    const currentZoom = zoomLevelRef.current;

    pendingWorkspaceRestoreRef.current = null;
    pendingLayoutRestoreRef.current = null;
    pendingViewportRestoreRef.current = viewportRestore;
    persistenceHydratedRef.current = true;
    if (nextZoom === currentZoom) {
      if (viewportRestore) {
        restoreFocalViewport(viewportRestore);
      }
      pendingViewportRestoreRef.current = null;
    } else {
      zoomLevelRef.current = nextZoom;
      setZoomLevel(nextZoom);
    }

    pinchGestureRef.current = null;
  }, [restoreFocalViewport]);

  const resumeTouchPan = React.useCallback(() => {
    const [remainingPointer] = Array.from(touchPointersRef.current.entries());
    const scrollContainer =
      touchScrollContainerRef.current ??
      getScrollViewportElement(scrollContainerRef);
    if (!remainingPointer || !scrollContainer) {
      activeInkActionRef.current = null;
      return;
    }

    const [pointerId, point] = remainingPointer;
    activeInkActionRef.current = {
      kind: 'pan',
      pointerId,
      startClientX: point.x,
      startClientY: point.y,
      startScrollLeft: scrollContainer.scrollLeft,
      startScrollTop: scrollContainer.scrollTop,
    };
    touchPanSamplesRef.current = [
      {
        x: point.x,
        y: point.y,
        time: performance.now(),
      },
    ];
  }, [scrollContainerRef]);

  const handleJumpToSlideNumber = React.useCallback(
    (pageNumber: number) => {
      if (!Number.isInteger(pageNumber) || pageNumber < 1) {
        return;
      }

      cancelTouchMomentum();

      const pageIndex = pageNumber - 1;
      const target = pageFigureRefs.current[pageIndex];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      currentSlideNumberRef.current = pageNumber;
      setCurrentSlideNumber(pageNumber);
    },
    [cancelTouchMomentum],
  );

  const handlePreviousSlide = React.useCallback(() => {
    const previousSlide = Math.max(1, currentSlideNumberRef.current - 1);
    if (previousSlide === currentSlideNumberRef.current) {
      return;
    }

    handleJumpToSlideNumber(previousSlide);
  }, [handleJumpToSlideNumber]);

  const handleNextSlide = React.useCallback(() => {
    if (currentPageCount < 1) {
      return;
    }

    const nextSlide = Math.min(
      currentPageCount,
      currentSlideNumberRef.current + 1,
    );
    if (nextSlide === currentSlideNumberRef.current) {
      return;
    }

    handleJumpToSlideNumber(nextSlide);
  }, [currentPageCount, handleJumpToSlideNumber]);

  const handleGoHome = React.useCallback(() => {
    cancelTouchMomentum();
    pendingViewportRestoreRef.current = null;
    pendingLayoutRestoreRef.current = null;
    const scrollContainer = getScrollViewportElement(scrollContainerRef);
    if (scrollContainer) {
      scrollContainer.scrollTo({
        top: 0,
        left: 0,
        behavior: 'smooth',
      });
    }

    currentSlideNumberRef.current = 1;
    setCurrentSlideNumber(1);
  }, [cancelTouchMomentum, scrollContainerRef]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (event.ctrlKey && !event.metaKey && key === 't') {
        event.preventDefault();
        setManualTool('text');
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'a') {
        event.preventDefault();
        if (filePath) {
          void flushPersistenceSaveRef.current().finally(onBackToAgenda);
        } else {
          onBackToAgenda?.();
        }
        return;
      }

      if (key === 'arrowleft' || key === 'pageup') {
        event.preventDefault();
        handlePreviousSlide();
        return;
      }

      if (key === 'arrowright' || key === 'pagedown') {
        event.preventDefault();
        handleNextSlide();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [filePath, handleNextSlide, handlePreviousSlide, onBackToAgenda]);

  const handleOpenLink = React.useCallback(async (url: string) => {
    await window.indicoInk.openExternalUrl(url);
  }, []);

  const handleDownloadLink = React.useCallback(async (url: string) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '';
    anchor.rel = 'noreferrer noopener';
    anchor.target = '_blank';
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const showCopyTooltip = React.useCallback(
    (message: string, clientX: number, clientY: number) => {
      if (copyTooltipHideTimerRef.current !== null) {
        window.clearTimeout(copyTooltipHideTimerRef.current);
        copyTooltipHideTimerRef.current = null;
      }

      setCopyTooltip({
        message,
        x: clientX + 16,
        y: clientY + 18,
      });
      copyTooltipHideTimerRef.current = window.setTimeout(() => {
        setCopyTooltip(null);
        copyTooltipHideTimerRef.current = null;
      }, 2500);
    },
    [],
  );

  const handleCopyLink = React.useCallback(
    async (
      url: string,
      event: React.MouseEvent<HTMLButtonElement>,
      message: string,
    ) => {
      showCopyTooltip(message, event.clientX, event.clientY);
      await copyTextToClipboard(url);
    },
    [showCopyTooltip],
  );

  const handleOpenLinkInIndicoInk = React.useCallback(
    async (url: string) => {
      await flushPersistenceSaveRef.current();
      if (onOpenIndicoEvent) {
        await onOpenIndicoEvent(url);
        return;
      }

      await window.indicoInk.openLibraryEvent(url);
    },
    [onOpenIndicoEvent],
  );

  const flushPersistenceSave = React.useCallback(async () => {
    if (
      (!filePath && !blankPageMode) ||
      (blankPageMode && !workspaceDeckId) ||
      readOnly ||
      state.kind !== 'ready' ||
      !persistenceHydratedRef.current
    ) {
      return;
    }

    if (persistenceSaveInFlightRef.current) {
      persistenceTrailingSaveRef.current = true;
      return;
    }
    persistenceSaveInFlightRef.current = true;
    if (persistenceSaveTimerRef.current !== null) {
      window.clearTimeout(persistenceSaveTimerRef.current);
      persistenceSaveTimerRef.current = null;
    }
    if (persistenceCheckpointTimerRef.current !== null) {
      window.clearTimeout(persistenceCheckpointTimerRef.current);
      persistenceCheckpointTimerRef.current = null;
    }

    const capturedPages: WorkspacePages = {
      strokesByPage: strokesByPageRef.current.slice(0, persistedPageCount),
      textNotesByPage: textNotesByPageRef.current.slice(0, persistedPageCount),
    };
    const revision = persistenceRevisionRef.current + 1;
    persistenceRevisionRef.current = revision;
    const batch = {
      sourceUrl: workspaceSourceUrl ?? filePath ?? '',
      pageCount: persistedPageCount,
      revision,
      changes: diffWorkspaceAnnotations(
        persistedWorkspacePagesRef.current,
        capturedPages,
      ),
      history: historyRef.current,
      currentSlideNumber: Math.min(
        currentSlideNumberRef.current,
        persistedPageCount,
      ),
      scrollLeft: getScrollViewportElement(scrollContainerRef).scrollLeft,
      scrollTop: getScrollViewportElement(scrollContainerRef).scrollTop,
      zoom: zoomLevel,
      ...(workspaceDeckId && conferenceId ? { conferenceId } : {}),
      ...(workspaceDeckId && talkId ? { talkId } : {}),
      ...(workspaceDeckId ? { deckId: workspaceDeckId } : {}),
    };

    try {
      const result = workspaceDeckId
        ? await window.indicoInk.saveDeckWorkspaceChanges(batch)
        : await window.indicoInk.savePdfWorkspaceChanges(batch);
      if (result.revision !== revision) {
        throw new Error(
          `Workspace save revision mismatch: expected ${revision}, received ${result.revision}.`,
        );
      }
      persistedWorkspacePagesRef.current = capturedPages;
      setPersistenceError(null);
    } catch (error) {
      setPersistenceError(
        error instanceof Error ? error.message : 'Failed to save workspace.',
      );
    } finally {
      persistenceSaveInFlightRef.current = false;
      if (persistenceTrailingSaveRef.current) {
        persistenceTrailingSaveRef.current = false;
        window.setTimeout(() => {
          void flushPersistenceSaveRef.current();
        }, 0);
      }
    }
  }, [
    conferenceId,
    currentPageCount,
    filePath,
    blankPageMode,
    persistedPageCount,
    readOnly,
    scrollContainerRef,
    state.kind,
    talkId,
    workspaceDeckId,
    workspaceSourceUrl,
    zoomLevel,
  ]);
  flushPersistenceSaveRef.current = flushPersistenceSave;

  React.useEffect(() => {
    const runtime = globalThis as typeof globalThis & {
      __indicoInkFlushWorkspace?: () => Promise<void>;
    };
    const flush = () => flushPersistenceSaveRef.current();
    runtime.__indicoInkFlushWorkspace = flush;
    return () => {
      if (runtime.__indicoInkFlushWorkspace === flush) {
        delete runtime.__indicoInkFlushWorkspace;
      }
    };
  }, []);

  const schedulePersistenceSave = React.useCallback(() => {
    if (
      (!filePath && !blankPageMode) ||
      (blankPageMode && !workspaceDeckId) ||
      readOnly ||
      state.kind !== 'ready' ||
      !persistenceHydratedRef.current
    ) {
      return;
    }

    if (persistenceSaveTimerRef.current !== null) {
      window.clearTimeout(persistenceSaveTimerRef.current);
    }
    persistenceSaveTimerRef.current = window.setTimeout(() => {
      void flushPersistenceSaveRef.current();
    }, 400);
    if (persistenceCheckpointTimerRef.current === null) {
      persistenceCheckpointTimerRef.current = window.setTimeout(() => {
        void flushPersistenceSaveRef.current();
      }, 2_000);
    }
  }, [blankPageMode, filePath, readOnly, state.kind, workspaceDeckId]);

  React.useEffect(() => {
    if (
      (!filePath && !blankPageMode) ||
      (blankPageMode && !workspaceDeckId) ||
      readOnly ||
      state.kind !== 'ready' ||
      !persistenceHydratedRef.current
    ) {
      return;
    }

    schedulePersistenceSave();
  }, [
    blankPageMode,
    filePath,
    schedulePersistenceSave,
    readOnly,
    state.kind,
    strokesByPage,
    textNotesByPage,
  ]);

  React.useEffect(
    () => () => {
      if (persistenceHydratedRef.current) {
        void flushPersistenceSaveRef.current();
      }
      if (persistenceSaveTimerRef.current !== null) {
        window.clearTimeout(persistenceSaveTimerRef.current);
        persistenceSaveTimerRef.current = null;
      }
      if (persistenceCheckpointTimerRef.current !== null) {
        window.clearTimeout(persistenceCheckpointTimerRef.current);
        persistenceCheckpointTimerRef.current = null;
      }
      if (activeInkFrameRef.current !== null) {
        window.cancelAnimationFrame(activeInkFrameRef.current);
        activeInkFrameRef.current = null;
      }
      cancelTouchMomentum();
    },
    [cancelTouchMomentum],
  );

  const paintActiveInkFrame = React.useCallback(() => {
    activeInkFrameRef.current = null;
    const action = activeInkActionRef.current;
    if (!action || action.kind !== 'draw') {
      return;
    }

    const pointCount = action.stroke.points.length;
    if (pointCount > action.renderedPointCount) {
      const firstPointIndex =
        action.renderedPointCount > 0 ? action.renderedPointCount - 1 : 0;
      drawInkPoints(
        wetInkCanvasRefs.current[action.pageIndex],
        action.stroke.points.slice(firstPointIndex),
        action.stroke.baseWidth ?? DEFAULT_PEN_THICKNESS,
        action.metrics,
        false,
        action.stroke.color,
      );
      action.renderedPointCount = pointCount;
    }

    const predictedPoints = predictedPointsRef.current;
    const lastRealPoint = action.stroke.points.at(-1);
    clearInkCanvas(
      predictedInkCanvasRefs.current[action.pageIndex],
      action.metrics,
    );
    if (lastRealPoint && predictedPoints.length) {
      drawInkPoints(
        predictedInkCanvasRefs.current[action.pageIndex],
        [lastRealPoint, ...predictedPoints],
        action.stroke.baseWidth ?? DEFAULT_PEN_THICKNESS,
        action.metrics,
        false,
        action.stroke.color,
      );
    }
  }, []);

  const scheduleActiveInkFrame = React.useCallback(() => {
    if (activeInkFrameRef.current === null) {
      activeInkFrameRef.current =
        window.requestAnimationFrame(paintActiveInkFrame);
    }
  }, [paintActiveInkFrame]);

  const finishActiveDraw = React.useCallback(
    (action: Extract<ActiveInkAction, { kind: 'draw' }>) => {
      if (activeInkFrameRef.current !== null) {
        window.cancelAnimationFrame(activeInkFrameRef.current);
        activeInkFrameRef.current = null;
      }
      paintActiveInkFrame();
      predictedPointsRef.current = [];
      clearInkCanvas(
        predictedInkCanvasRefs.current[action.pageIndex],
        action.metrics,
      );
      drawInkPoints(
        dryInkCanvasRefs.current[action.pageIndex],
        action.stroke.points,
        action.stroke.baseWidth ?? DEFAULT_PEN_THICKNESS,
        action.metrics,
        false,
        action.stroke.color,
      );
      liveCommittedStrokeIdsRef.current.add(action.stroke.id);
      clearInkCanvas(
        wetInkCanvasRefs.current[action.pageIndex],
        action.metrics,
      );

      if (!action.stroke.points.length) {
        return;
      }
      const before: WorkspacePages = {
        strokesByPage: strokesByPageRef.current,
        textNotesByPage: textNotesByPageRef.current,
      };
      const nextStrokesByPage = strokesByPageRef.current.length
        ? [...strokesByPageRef.current]
        : createEmptyStrokePages(currentPageCount);
      nextStrokesByPage[action.pageIndex] = [
        ...(nextStrokesByPage[action.pageIndex] ?? []),
        {
          ...action.stroke,
          points: [...action.stroke.points],
        },
      ];
      strokesByPageRef.current = nextStrokesByPage;
      setStrokesByPage(nextStrokesByPage);
      recordWorkspaceChange(before, {
        strokesByPage: nextStrokesByPage,
        textNotesByPage: textNotesByPageRef.current,
      });
    },
    [currentPageCount, paintActiveInkFrame, recordWorkspaceChange],
  );

  const handlePagePointerEvent = React.useCallback(
    (pageIndex: number, eventKind: PointerEventKind) =>
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (
          textNoteResizeState?.pointerId === event.pointerId &&
          textNoteResizeState?.pageIndex === pageIndex
        ) {
          if (eventKind === 'pointermove') {
            const pageWidth = event.currentTarget.getBoundingClientRect().width;
            if (pageWidth > 0) {
              setTextNoteDraft((currentDraft) =>
                currentDraft
                  ? {
                      ...currentDraft,
                      width: clampTextNoteWidth(
                        textNoteResizeState.startWidth +
                          (event.clientX - textNoteResizeState.startClientX) /
                            pageWidth,
                      ),
                    }
                  : currentDraft,
              );
            }
          }

          if (eventKind === 'pointerup' || eventKind === 'pointercancel') {
            setTextNoteResizeState(null);
          }
          event.preventDefault();
          return;
        }

        if (textNoteDraft && eventKind === 'pointerdown') {
          event.preventDefault();
          textNoteEditorRef.current?.blur();
          return;
        }

        const pageSize =
          state.kind === 'loading' || state.kind === 'ready'
            ? state.pageSizes[pageIndex]
            : undefined;

        const isTouchPointer = event.pointerType === 'touch';
        if (isTouchPointer && eventKind === 'pointerdown') {
          touchScrollContainerRef.current =
            getNearestScrollableAncestor(event.currentTarget) ??
            getScrollViewportElement(scrollContainerRef);
          cancelTouchMomentum();
          touchPanSamplesRef.current = [
            {
              x: event.clientX,
              y: event.clientY,
              time: event.timeStamp > 0 ? event.timeStamp : performance.now(),
            },
          ];
        }
        if (
          isTouchPointer &&
          (eventKind === 'pointerdown' || eventKind === 'pointermove')
        ) {
          touchPointersRef.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
        }

        const resolution = handlePointerEvent(eventKind)(event);

        if (
          isTouchPointer &&
          eventKind === 'pointerdown' &&
          !pinchGestureRef.current &&
          touchPointersRef.current.size >= 2
        ) {
          const [first, second] = Array.from(touchPointersRef.current.values());
          if (first && second) {
            beginPinchGesture(first, second);
            event.preventDefault();
            return;
          }
        }

        if (isTouchPointer && pinchGestureRef.current) {
          if (eventKind === 'pointermove') {
            updatePinchGesture();
            event.preventDefault();
          }

          if (eventKind === 'pointerup' || eventKind === 'pointercancel') {
            commitPinchGesture();
            touchPointersRef.current.delete(event.pointerId);
            resumeTouchPan();
            event.preventDefault();
          }

          if (
            eventKind === 'pointermove' ||
            eventKind === 'pointerup' ||
            eventKind === 'pointercancel'
          ) {
            return;
          }
        }

        if (
          isTouchPointer &&
          (eventKind === 'pointerup' || eventKind === 'pointercancel')
        ) {
          touchPointersRef.current.delete(event.pointerId);
        }

        const { interactionMode, renderedTool } = resolution;
        const needsPagePoint =
          interactionMode === 'draw' ||
          interactionMode === 'erase' ||
          interactionMode === 'text';
        if (eventKind === 'pointerdown' && needsPagePoint) {
          activePageBoundsRef.current = {
            pointerId: event.pointerId,
            pageIndex,
            bounds: event.currentTarget.getBoundingClientRect(),
          };
        }
        const activePageBounds = activePageBoundsRef.current;
        const pagePoint =
          needsPagePoint &&
          pageSize &&
          pageSize.width > 0 &&
          pageSize.height > 0
            ? getPagePoint(
                event,
                activePageBounds?.pointerId === event.pointerId &&
                  activePageBounds.pageIndex === pageIndex
                  ? activePageBounds.bounds
                  : undefined,
              )
            : null;
        const isStylusTool =
          resolution.toolState.resolvedTool === 'pen' ||
          resolution.toolState.resolvedTool === 'eraser';
        const shouldShowMarker =
          pagePoint !== null &&
          isStylusTool &&
          (interactionMode === 'draw' || interactionMode === 'erase');
        const isActivePointerMove =
          eventKind === 'pointermove' &&
          activeInkActionRef.current?.pointerId === event.pointerId;

        if (shouldShowMarker && !isActivePointerMove) {
          setPointerMarker({
            pageIndex,
            point: pagePoint,
            tool: renderedTool === 'eraser' ? 'eraser' : 'pen',
          });
        } else if (!isActivePointerMove) {
          setPointerMarker(null);
        }

        if (eventKind === 'pointerdown') {
          currentSlideNumberRef.current = pageIndex + 1;

          if (interactionMode === 'text' && pagePoint) {
            event.preventDefault();
            if (textNoteDraft) {
              textNoteEditorRef.current?.blur();
              return;
            }
            const noteId = createTextNoteId();
            activeInkActionRef.current = {
              kind: 'text',
              pointerId: event.pointerId,
              pageIndex,
              startClientX: event.clientX,
              startClientY: event.clientY,
            };
            setTextNoteDraft({
              mode: 'create',
              noteId,
              pageIndex,
              x: pagePoint.x,
              y: pagePoint.y,
              width: DEFAULT_TEXT_NOTE_WIDTH,
              text: '',
            });
            return;
          }

          if (interactionMode === 'draw' && pagePoint && pageSize) {
            event.preventDefault();
            const storedBaseWidth = getFitWidthNormalizedPenWidth(
              selectedPenThickness,
              previewViewportWidth,
              pageSize.width,
            );
            const bounds =
              activePageBoundsRef.current?.bounds ??
              event.currentTarget.getBoundingClientRect();
            activeInkActionRef.current = {
              kind: 'draw',
              pointerId: event.pointerId,
              pageIndex,
              stroke: {
                id: createStrokeId(),
                pageNumber: pageIndex + 1,
                baseWidth: storedBaseWidth,
                color: selectedPenColor,
                points: [pagePoint],
              },
              renderedPointCount: 0,
              metrics: {
                displayWidth: Math.max(1, bounds.width),
                displayHeight: Math.max(1, bounds.height),
                pageSize,
              },
            };
            predictedPointsRef.current = [];
            scheduleActiveInkFrame();
            return;
          }

          if (interactionMode === 'erase' && pagePoint && pageSize) {
            event.preventDefault();
            const beforeStrokes = [
              ...(strokesByPageRef.current[pageIndex] ?? []),
            ];
            const spatialIndex = createStrokeSpatialIndex(
              beforeStrokes,
              pageSize,
            );
            activeInkActionRef.current = {
              kind: 'erase',
              pointerId: event.pointerId,
              pageIndex,
              beforeStrokes,
              spatialIndex,
            };
            const candidates = spatialIndex.query(pagePoint);
            setStrokesByPage((currentPages) => {
              const nextPages = currentPages.length
                ? [...currentPages]
                : createEmptyStrokePages(
                    state.kind === 'loading' || state.kind === 'ready'
                      ? state.pageCount
                      : 0,
                  );
              nextPages[pageIndex] = (nextPages[pageIndex] ?? []).filter(
                (stroke) =>
                  !candidates.has(stroke.id) ||
                  !strokeHitsPoint(
                    stroke,
                    pagePoint,
                    pageSize,
                    strokeSegmentCacheRef.current,
                  ),
              );
              strokesByPageRef.current = nextPages;
              return nextPages;
            });
            return;
          }

          const scrollContainer =
            touchScrollContainerRef.current ??
            getScrollViewportElement(scrollContainerRef);
          if (interactionMode === 'pan' && scrollContainer) {
            activeInkActionRef.current = {
              kind: 'pan',
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startClientY: event.clientY,
              startScrollLeft: scrollContainer.scrollLeft,
              startScrollTop: scrollContainer.scrollTop,
            };
            event.preventDefault();
          }
        }

        if (
          eventKind === 'pointermove' &&
          activeInkActionRef.current &&
          activeInkActionRef.current.pointerId === event.pointerId
        ) {
          if (activeInkActionRef.current.kind === 'text') {
            const moved = Math.hypot(
              event.clientX - activeInkActionRef.current.startClientX,
              event.clientY - activeInkActionRef.current.startClientY,
            );
            if (moved > 8 && event.pointerType === 'touch') {
              setTextNoteDraft(null);
              const scrollContainer =
                touchScrollContainerRef.current ??
                getScrollViewportElement(scrollContainerRef);
              activeInkActionRef.current = {
                kind: 'pan',
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                startScrollLeft: scrollContainer.scrollLeft,
                startScrollTop: scrollContainer.scrollTop,
              };
            }
          }
          if (
            activeInkActionRef.current.kind === 'draw' &&
            activeInkActionRef.current.pageIndex === pageIndex &&
            pagePoint
          ) {
            event.preventDefault();
            const activeDraw = activeInkActionRef.current;
            const pageBounds =
              activePageBoundsRef.current?.pointerId === event.pointerId &&
              activePageBoundsRef.current.pageIndex === pageIndex
                ? activePageBoundsRef.current.bounds
                : event.currentTarget.getBoundingClientRect();
            const pagePoints = getCoalescedPagePoints(event, pageBounds);
            const uniquePoints = dropExactDuplicatePoints(
              activeDraw.stroke.points.at(-1),
              pagePoints,
            );
            activeDraw.stroke.points.push(...uniquePoints);
            predictedPointsRef.current = dropExactDuplicatePoints(
              activeDraw.stroke.points.at(-1),
              getPredictedPagePoints(event, pageBounds),
            );
            scheduleActiveInkFrame();
          }

          if (
            activeInkActionRef.current.kind === 'erase' &&
            activeInkActionRef.current.pageIndex === pageIndex &&
            pagePoint &&
            pageSize
          ) {
            event.preventDefault();
            const candidates =
              activeInkActionRef.current.spatialIndex.query(pagePoint);
            updateStrokePage(pageIndex, (currentStrokes) =>
              currentStrokes.filter(
                (stroke) =>
                  !candidates.has(stroke.id) ||
                  !strokeHitsPoint(
                    stroke,
                    pagePoint,
                    pageSize,
                    strokeSegmentCacheRef.current,
                  ),
              ),
            );
          }

          if (
            activeInkActionRef.current.kind === 'pan' &&
            activeInkActionRef.current.pointerId === event.pointerId &&
            (touchScrollContainerRef.current ??
              getScrollViewportElement(scrollContainerRef))
          ) {
            const scrollContainer =
              touchScrollContainerRef.current ??
              getScrollViewportElement(scrollContainerRef);
            const deltaX =
              event.clientX - activeInkActionRef.current.startClientX;
            const deltaY =
              event.clientY - activeInkActionRef.current.startClientY;

            scrollContainer.scrollLeft =
              activeInkActionRef.current.startScrollLeft - deltaX;
            scrollContainer.scrollTop =
              activeInkActionRef.current.startScrollTop - deltaY;
            touchPanSamplesRef.current.push({
              x: event.clientX,
              y: event.clientY,
              time: event.timeStamp > 0 ? event.timeStamp : performance.now(),
            });
            if (touchPanSamplesRef.current.length > 8) {
              touchPanSamplesRef.current.shift();
            }
            event.preventDefault();
          }
        }

        if (
          eventKind === 'pointermove' &&
          textNoteDragState &&
          textNoteDragState.pointerId === event.pointerId &&
          textNoteDragState.pageIndex === pageIndex
        ) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (bounds.width <= 0 || bounds.height <= 0) {
            return;
          }
          const nextX = clamp01(
            (event.clientX - bounds.left - textNoteDragState.startOffsetX) /
              bounds.width,
          );
          const nextY = clamp01(
            (event.clientY - bounds.top - textNoteDragState.startOffsetY) /
              bounds.height,
          );

          if (textNoteDraft?.noteId === textNoteDragState.noteId) {
            setTextNoteDraft((currentDraft) =>
              currentDraft
                ? { ...currentDraft, x: nextX, y: nextY }
                : currentDraft,
            );
          } else {
            updateTextNotePage(pageIndex, (currentTextNotes) =>
              currentTextNotes.map((note) =>
                note.id === textNoteDragState.noteId
                  ? {
                      ...note,
                      x: nextX,
                      y: nextY,
                      updatedAt: Date.now(),
                    }
                  : note,
              ),
            );
          }
          event.preventDefault();
        }

        if (eventKind === 'pointerup' || eventKind === 'pointercancel') {
          const activeInkAction = activeInkActionRef.current;
          if (activeInkAction?.kind === 'draw') {
            finishActiveDraw(activeInkAction);
          } else if (activeInkAction?.kind === 'erase') {
            const beforeStrokesByPage = [...strokesByPageRef.current];
            beforeStrokesByPage[activeInkAction.pageIndex] =
              activeInkAction.beforeStrokes;
            recordWorkspaceChange(
              {
                strokesByPage: beforeStrokesByPage,
                textNotesByPage: textNotesByPageRef.current,
              },
              {
                strokesByPage: strokesByPageRef.current,
                textNotesByPage: textNotesByPageRef.current,
              },
            );
          }
          if (
            activeInkAction &&
            activeInkAction.pointerId === event.pointerId &&
            (activeInkAction.kind === 'pan' ||
              activeInkAction.kind === 'text' ||
              activeInkAction.pageIndex === pageIndex)
          ) {
            if (eventKind === 'pointerup' && activeInkAction.kind === 'pan') {
              startTouchMomentum(
                getTouchPanVelocity(touchPanSamplesRef.current),
              );
            }
            activeInkActionRef.current = null;
          }

          if (
            eventKind === 'pointerup' &&
            activeInkAction &&
            activeInkAction.kind !== 'pan' &&
            activeInkAction.pageIndex === pageIndex
          ) {
            setCurrentSlideNumber(pageIndex + 1);
          }

          if (pointerMarker?.pageIndex === pageIndex) {
            setPointerMarker(null);
          }
          if (
            textNoteDragState?.pointerId === event.pointerId &&
            textNoteDragState?.pageIndex === pageIndex
          ) {
            const beforeTextNotesByPage = [...textNotesByPageRef.current];
            beforeTextNotesByPage[pageIndex] = (
              beforeTextNotesByPage[pageIndex] ?? []
            ).map((note) =>
              note.id === textNoteDragState.noteId
                ? textNoteDragState.beforeNote
                : note,
            );
            recordWorkspaceChange(
              {
                strokesByPage: strokesByPageRef.current,
                textNotesByPage: beforeTextNotesByPage,
              },
              {
                strokesByPage: strokesByPageRef.current,
                textNotesByPage: textNotesByPageRef.current,
              },
            );
            setTextNoteDragState(null);
          }
          if (activePageBoundsRef.current?.pointerId === event.pointerId) {
            activePageBoundsRef.current = null;
          }
        }
      },
    [
      cancelTouchMomentum,
      beginPinchGesture,
      commitPinchGesture,
      handlePointerEvent,
      pointerMarker,
      resolvePointerInteraction,
      resumeTouchPan,
      startTouchMomentum,
      state,
      finishActiveDraw,
      previewViewportWidth,
      selectedPenThickness,
      selectedPenColor,
      textNoteDragState,
      textNoteDraft,
      textNoteResizeState,
      updatePinchGesture,
      updateStrokePage,
      updateTextNotePage,
      scrollContainerRef,
      recordWorkspaceChange,
      scheduleActiveInkFrame,
    ],
  );

  React.useEffect(() => {
    const scrollContainer = getScrollViewportElement(scrollContainerRef);
    if (!scrollContainer) {
      return;
    }

    const handleScroll = () => {
      if (
        (!filePath && !blankPageMode) ||
        state.kind !== 'ready' ||
        !persistenceHydratedRef.current
      ) {
        return;
      }

      schedulePersistenceSave();
    };

    scrollContainer.addEventListener('scroll', handleScroll, {
      passive: true,
    });

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [
    blankPageMode,
    filePath,
    schedulePersistenceSave,
    scrollContainerRef,
    state.kind,
  ]);

  React.useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    if (!filePath && !blankPageMode) {
      pageCanvasRefs.current = [];
      setState({ kind: 'idle' });
      setStrokesByPage([]);
      setTextNotesByPage([]);
      setLinkHotspotsByPage([]);
      setActiveLinkPopover(null);
      const emptyHistory = createWorkspaceHistory();
      historyRef.current = emptyHistory;
      setHistory(emptyHistory);
      strokesByPageRef.current = [];
      textNotesByPageRef.current = [];
      persistedWorkspacePagesRef.current = {
        strokesByPage: [],
        textNotesByPage: [],
      };
      setPointerMarker(null);
      setTextNoteDraft(null);
      setTextNoteDragState(null);
      pendingWorkspaceRestoreRef.current = null;
      pendingLayoutRestoreRef.current = null;
      persistenceHydratedRef.current = false;
      workspaceSourceKeyRef.current = null;
      setPersistenceError(null);
      if (persistenceSaveTimerRef.current !== null) {
        window.clearTimeout(persistenceSaveTimerRef.current);
        persistenceSaveTimerRef.current = null;
      }
      return () => {
        cancelled = true;
        if (pointerDiagnosticsFrameRef.current !== null) {
          window.cancelAnimationFrame(pointerDiagnosticsFrameRef.current);
        }
        if (persistenceSaveTimerRef.current !== null) {
          window.clearTimeout(persistenceSaveTimerRef.current);
        }
        void loadingTask?.destroy?.();
      };
    }

    if (blankPageMode) {
      const loadBlankWorkspace = async () => {
        const sourceKey = `notebook:${workspaceDeckId ?? workspaceSourceUrl ?? 'local'}`;
        const shouldHydrateWorkspace =
          workspaceSourceKeyRef.current !== sourceKey ||
          !persistenceHydratedRef.current;
        workspaceSourceKeyRef.current = sourceKey;
        persistenceHydratedRef.current = false;
        setPersistenceError(null);

        const savedWorkspace = workspaceDeckId
          ? await window.indicoInk.loadDeckWorkspaceState(workspaceDeckId)
          : null;
        if (cancelled) {
          return;
        }

        const savedPageCount = savedWorkspace?.pageCount ?? 0;
        const loadedStrokes = savedWorkspace?.strokesByPage ?? [];
        const loadedNotes = savedWorkspace?.textNotesByPage ?? [];
        const pageCount = savedPageCount + 1;
        const strokes = [
          ...loadedStrokes.slice(0, savedPageCount),
          [] as InkStroke[],
        ];
        const notes = [
          ...loadedNotes.slice(0, savedPageCount),
          [] as TextNote[],
        ];
        const history = savedWorkspace?.history ?? createWorkspaceHistory();
        strokesByPageRef.current = strokes;
        textNotesByPageRef.current = notes;
        persistedWorkspacePagesRef.current = {
          strokesByPage: loadedStrokes.slice(0, savedPageCount),
          textNotesByPage: loadedNotes.slice(0, savedPageCount),
        };
        historyRef.current = history;
        persistenceRevisionRef.current = savedWorkspace?.revision ?? 0;
        currentSlideNumberRef.current = savedWorkspace?.currentSlideNumber ?? 1;
        setCurrentSlideNumber(currentSlideNumberRef.current);
        setStrokesByPage(strokes);
        setTextNotesByPage(notes);
        setHistory(history);
        setPointerMarker(null);
        setTextNoteDraft(null);
        setTextNoteDragState(null);
        pendingWorkspaceRestoreRef.current = shouldHydrateWorkspace
          ? {
              sourceUrl: workspaceSourceUrl ?? '',
              ...(conferenceId ? { conferenceId } : {}),
              ...(talkId ? { talkId } : {}),
              ...(workspaceDeckId ? { deckId: workspaceDeckId } : {}),
              pageCount: savedPageCount,
              ...(savedWorkspace?.revision !== undefined
                ? { revision: savedWorkspace.revision }
                : {}),
              strokesByPage: loadedStrokes,
              textNotesByPage: loadedNotes,
              history,
              currentSlideNumber: savedWorkspace?.currentSlideNumber ?? 1,
              scrollLeft: savedWorkspace?.scrollLeft ?? 0,
              scrollTop: savedWorkspace?.scrollTop ?? 0,
              zoom: savedWorkspace?.zoom ?? 1,
            }
          : null;
        setState({
          kind: 'ready',
          label: 'Notes ready.',
          pageCount,
          pageSizes: Array.from({ length: pageCount }, () => ({
            width: 800,
            height: 1100,
          })),
          pageStatuses: Array.from(
            { length: pageCount },
            () => 'ready' as const,
          ),
        });
      };

      void loadBlankWorkspace().catch((error) => {
        if (!cancelled) {
          setState(
            createErrorPreviewState(
              error instanceof Error ? error.message : 'Notes preview failed.',
            ),
          );
        }
      });

      return () => {
        cancelled = true;
      };
    }

    if (previewViewportWidth <= 0) {
      setState((currentState) =>
        currentState.kind === 'ready' || currentState.kind === 'loading'
          ? createLoadingPreviewState(
              currentState.pageCount > 0
                ? 'Preparing a new render...'
                : 'Loading PDF...',
              currentState.pageCount,
              currentState.pageSizes,
              currentState.pageStatuses,
            )
          : createLoadingPreviewState('Loading PDF...'),
      );
      setLinkHotspotsByPage([]);
      setActiveLinkPopover(null);
      return () => {
        cancelled = true;
        if (pointerDiagnosticsFrameRef.current !== null) {
          window.cancelAnimationFrame(pointerDiagnosticsFrameRef.current);
        }
        if (persistenceSaveTimerRef.current !== null) {
          window.clearTimeout(persistenceSaveTimerRef.current);
        }
        void loadingTask?.destroy?.();
      };
    }

    const renderPreview = async () => {
      latchedToolRef.current = null;
      strokeSegmentCacheRef.current.clear();
      setPointerDiagnostics(createIdlePointerDiagnostics());
      if (!filePath) {
        pageCanvasRefs.current = [];
        setState({ kind: 'idle' });
        setStrokesByPage([]);
        setTextNotesByPage([]);
        setLinkHotspotsByPage([]);
        setActiveLinkPopover(null);
        const emptyHistory = createWorkspaceHistory();
        historyRef.current = emptyHistory;
        setHistory(emptyHistory);
        strokesByPageRef.current = [];
        textNotesByPageRef.current = [];
        persistedWorkspacePagesRef.current = {
          strokesByPage: [],
          textNotesByPage: [],
        };
        setPointerMarker(null);
        setTextNoteDraft(null);
        setTextNoteDragState(null);
        pendingWorkspaceRestoreRef.current = null;
        pendingLayoutRestoreRef.current = null;
        persistenceHydratedRef.current = false;
        setPersistenceError(null);
        if (persistenceSaveTimerRef.current !== null) {
          window.clearTimeout(persistenceSaveTimerRef.current);
          persistenceSaveTimerRef.current = null;
        }
        return;
      }

      const currentScrollContainer =
        getScrollViewportElement(scrollContainerRef);
      const workspaceSourceKey = workspaceDeckId
        ? `deck:${workspaceDeckId}`
        : `pdf:${filePath}`;
      const shouldHydrateWorkspace =
        !readOnly &&
        (workspaceSourceKeyRef.current !== workspaceSourceKey ||
          !persistenceHydratedRef.current);
      workspaceSourceKeyRef.current = workspaceSourceKey;
      if (state.kind === 'ready' || state.kind === 'loading') {
        if (pendingViewportRestoreRef.current?.mode === 'focal') {
          pendingLayoutRestoreRef.current = null;
        } else {
          pendingLayoutRestoreRef.current = {
            scrollLeft: currentScrollContainer.scrollLeft,
            scrollTop: currentScrollContainer.scrollTop,
            currentSlideNumber: currentSlideNumberRef.current,
          };
        }
      }

      setState((currentState) =>
        currentState.kind === 'ready' || currentState.kind === 'loading'
          ? createLoadingPreviewState(
              'Preparing a new render...',
              currentState.pageCount,
              currentState.pageSizes,
              currentState.pageStatuses,
            )
          : createLoadingPreviewState('Loading PDF...'),
      );
      pendingWorkspaceRestoreRef.current = null;
      if (shouldHydrateWorkspace) {
        persistenceHydratedRef.current = false;
      }
      setPersistenceError(null);
      if (persistenceSaveTimerRef.current !== null) {
        window.clearTimeout(persistenceSaveTimerRef.current);
        persistenceSaveTimerRef.current = null;
      }

      try {
        const bytes = await window.indicoInk.readPdfBytes(filePath);
        if (cancelled) {
          return;
        }

        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        loadingTask = getDocument({
          data: bytes,
          intent: 'print',
        } as never);

        const document = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }

        const pageCount = document.numPages;
        if (pageCanvasRefs.current.length !== pageCount) {
          pageCanvasRefs.current = Array.from(
            { length: pageCount },
            () => null,
          );
        }
        dryInkCanvasRefs.current = Array.from(
          { length: pageCount },
          (_, index) => dryInkCanvasRefs.current[index] ?? null,
        );
        wetInkCanvasRefs.current = Array.from(
          { length: pageCount },
          (_, index) => wetInkCanvasRefs.current[index] ?? null,
        );
        predictedInkCanvasRefs.current = Array.from(
          { length: pageCount },
          (_, index) => predictedInkCanvasRefs.current[index] ?? null,
        );
        if (pageFigureRefs.current.length !== pageCount) {
          pageFigureRefs.current = Array.from(
            { length: pageCount },
            () => null,
          );
        }
        if (shouldHydrateWorkspace) {
          const emptyStrokes = createEmptyStrokePages(pageCount);
          const emptyNotes = createEmptyTextNotePages(pageCount);
          strokesByPageRef.current = emptyStrokes;
          textNotesByPageRef.current = emptyNotes;
          setStrokesByPage(emptyStrokes);
          setTextNotesByPage(emptyNotes);
        }
        const nextLinkHotspotsByPage = createEmptyLinkHotspotPages(pageCount);
        if (shouldHydrateWorkspace) {
          const emptyHistory = createWorkspaceHistory();
          historyRef.current = emptyHistory;
          setHistory(emptyHistory);
        }
        setPointerMarker(null);
        setTextNoteDraft(null);
        setTextNoteDragState(null);
        const pageSizes = createPageSizes(pageCount);
        const pageStatuses = createPageStatuses(pageCount);
        setState((currentState) =>
          currentState.kind === 'ready' || currentState.kind === 'loading'
            ? {
                kind: 'loading',
                label: 'Preparing slides...',
                pageCount,
                pageSizes:
                  currentState.pageCount === pageCount
                    ? currentState.pageSizes
                    : pageSizes,
                pageStatuses:
                  currentState.pageCount === pageCount
                    ? currentState.pageStatuses
                    : pageStatuses,
              }
            : {
                kind: 'loading',
                label: 'Preparing slides...',
                pageCount,
                pageSizes,
                pageStatuses,
              },
        );
        await waitForNextFrame();

        if (shouldHydrateWorkspace) {
          const savedWorkspace = workspaceDeckId
            ? await window.indicoInk.loadDeckWorkspaceState(workspaceDeckId)
            : await window.indicoInk.loadPdfWorkspaceState(filePath);
          if (cancelled) {
            return;
          }

          if (savedWorkspace) {
            const loadedStrokes = savedWorkspace.strokesByPage.length
              ? savedWorkspace.strokesByPage
              : createEmptyStrokePages(pageCount);
            const loadedNotes = savedWorkspace.textNotesByPage?.length
              ? savedWorkspace.textNotesByPage
              : createEmptyTextNotePages(pageCount);
            const loadedHistory =
              savedWorkspace.history ??
              migrateLegacyWorkspaceHistory(
                {
                  strokesByPage: loadedStrokes,
                  textNotesByPage: loadedNotes,
                },
                savedWorkspace.undoStack,
                savedWorkspace.redoStack,
              );
            strokesByPageRef.current = loadedStrokes;
            textNotesByPageRef.current = loadedNotes;
            historyRef.current = loadedHistory;
            persistedWorkspacePagesRef.current = {
              strokesByPage: loadedStrokes,
              textNotesByPage: loadedNotes,
            };
            persistenceRevisionRef.current = savedWorkspace.revision ?? 0;
            setStrokesByPage(loadedStrokes);
            setTextNotesByPage(loadedNotes);
            setHistory(loadedHistory);
            pendingWorkspaceRestoreRef.current = savedWorkspace;
          } else {
            persistedWorkspacePagesRef.current = {
              strokesByPage: createEmptyStrokePages(pageCount),
              textNotesByPage: createEmptyTextNotePages(pageCount),
            };
            persistenceRevisionRef.current = 0;
            pendingWorkspaceRestoreRef.current = null;
          }
        }

        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          if (cancelled) {
            break;
          }

          const page = await document.getPage(pageNumber);
          if (cancelled) {
            break;
          }

          const canvas = pageCanvasRefs.current[pageNumber - 1];
          if (!canvas) {
            throw new Error(
              `Canvas rendering is unavailable for page ${pageNumber}.`,
            );
          }

          const baseViewport = page.getViewport({ scale: 1 });
          const fitScale =
            previewViewportWidth > 0
              ? previewViewportWidth / baseViewport.width
              : 1;
          const viewport = page.getViewport({
            scale: fitScale * zoomLevel,
          });
          const scale = window.devicePixelRatio || 1;
          const width = Math.floor(viewport.width);
          const height = Math.floor(viewport.height);

          const nextCanvas = window.document.createElement('canvas');
          const nextContext = nextCanvas.getContext('2d');
          if (!nextContext) {
            throw new Error(
              `Canvas rendering is unavailable for page ${pageNumber}.`,
            );
          }
          nextCanvas.width = Math.floor(width * scale);
          nextCanvas.height = Math.floor(height * scale);
          nextContext.setTransform(scale, 0, 0, scale, 0, 0);

          await page.render({
            canvas: nextCanvas,
            canvasContext: nextContext,
            viewport,
          }).promise;

          if (cancelled) {
            break;
          }

          const context = canvas.getContext('2d');
          if (!context) {
            throw new Error(
              `Canvas rendering is unavailable for page ${pageNumber}.`,
            );
          }
          canvas.width = nextCanvas.width;
          canvas.height = nextCanvas.height;
          context.drawImage(nextCanvas, 0, 0);

          nextLinkHotspotsByPage[pageNumber - 1] = await getLinkHotspotsForPage(
            page,
            viewport,
          );

          // Keep the PDF's intrinsic dimensions separate from the rendered
          // bitmap dimensions. The display scale applies zoom to these base
          // dimensions; storing the zoomed viewport here would cancel the
          // toolbar zoom when the page is laid out again.
          pageSizes[pageNumber - 1] = {
            width: baseViewport.width,
            height: baseViewport.height,
          };
          pageStatuses[pageNumber - 1] = 'ready';
          if (shouldHydrateWorkspace) {
            setState((currentState) => {
              if (currentState.kind !== 'loading') {
                return currentState;
              }

              const nextPageSizes =
                currentState.pageCount === pageCount
                  ? [...currentState.pageSizes]
                  : createPageSizes(pageCount);
              const nextPageStatuses =
                currentState.pageCount === pageCount
                  ? [...currentState.pageStatuses]
                  : createPageStatuses(pageCount);
              nextPageSizes[pageNumber - 1] = {
                width: baseViewport.width,
                height: baseViewport.height,
              };
              nextPageStatuses[pageNumber - 1] = 'ready';

              return {
                ...currentState,
                label: 'Preparing slides...',
                pageCount,
                pageSizes: nextPageSizes,
                pageStatuses: nextPageStatuses,
              };
            });
          }
        }

        if (!cancelled) {
          setLinkHotspotsByPage(nextLinkHotspotsByPage);
          setState({
            kind: 'ready',
            label: 'Slides ready.',
            pageCount,
            pageSizes,
            pageStatuses,
          });
          setPersistenceError(null);
        }

        await loadingTask.destroy();
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : 'PDF preview failed.';
          setState((currentState) => {
            if (
              currentState.kind === 'ready' ||
              currentState.kind === 'loading'
            ) {
              return {
                kind: 'error',
                label: message,
                pageCount: currentState.pageCount,
                pageSizes: currentState.pageSizes,
                pageStatuses: currentState.pageStatuses,
              };
            }

            return createErrorPreviewState(message);
          });
          setPersistenceError(message);
        }
      }
    };

    void renderPreview();

    return () => {
      cancelled = true;
      if (pointerDiagnosticsFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerDiagnosticsFrameRef.current);
      }
      if (persistenceSaveTimerRef.current !== null) {
        window.clearTimeout(persistenceSaveTimerRef.current);
      }
      void loadingTask?.destroy?.();
    };
  }, [
    blankPageMode,
    conferenceId,
    filePath,
    previewViewportWidth,
    readOnly,
    talkId,
    workspaceDeckId,
    workspaceSourceUrl,
    zoomLevel,
  ]);

  React.useEffect(() => {
    if (state.kind !== 'ready' || (!filePath && !blankPageMode)) {
      return;
    }

    const pageStatuses = readyPageStatuses;
    if (!pageStatuses) {
      return;
    }

    if (pageStatuses.some((pageStatus) => pageStatus !== 'ready')) {
      return;
    }

    const restore = pendingWorkspaceRestoreRef.current;
    if (!restore) {
      const layoutRestore = pendingLayoutRestoreRef.current;
      if (!layoutRestore) {
        persistenceHydratedRef.current = true;
        return;
      }

      const frame = window.requestAnimationFrame(() => {
        if (pendingLayoutRestoreRef.current !== layoutRestore) {
          return;
        }

        const scrollContainer = getScrollViewportElement(scrollContainerRef);
        if (scrollContainer) {
          scrollContainer.scrollLeft = layoutRestore.scrollLeft;
          scrollContainer.scrollTop = layoutRestore.scrollTop;
        }

        currentSlideNumberRef.current = layoutRestore.currentSlideNumber;
        setCurrentSlideNumber(layoutRestore.currentSlideNumber);
        pendingLayoutRestoreRef.current = null;
        persistenceHydratedRef.current = true;
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    const frame = window.requestAnimationFrame(() => {
      if (pendingWorkspaceRestoreRef.current !== restore) {
        return;
      }

      const scrollContainer = getScrollViewportElement(scrollContainerRef);
      if (scrollContainer) {
        scrollContainer.scrollLeft = restore.scrollLeft;
        scrollContainer.scrollTop = restore.scrollTop;
      }

      currentSlideNumberRef.current = restore.currentSlideNumber;
      setCurrentSlideNumber(restore.currentSlideNumber);
      const restoredZoom = clampPdfZoom(restore.zoom || 1);
      zoomLevelRef.current = restoredZoom;
      setZoomLevel(restoredZoom);
      pendingWorkspaceRestoreRef.current = null;
      pendingLayoutRestoreRef.current = null;
      persistenceHydratedRef.current = true;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    blankPageMode,
    filePath,
    readyPageStatuses,
    scrollContainerRef,
    state.kind,
  ]);

  React.useLayoutEffect(() => {
    const viewportRestore = pendingViewportRestoreRef.current;
    if (
      !viewportRestore ||
      previewViewportWidth <= 0 ||
      state.kind !== 'ready' ||
      readyPageStatuses?.some((pageStatus) => pageStatus !== 'ready')
    ) {
      return;
    }

    const scrollContainer = getScrollViewportElement(scrollContainerRef);
    const pageFigure = pageFigureRefs.current[viewportRestore.pageIndex];
    if (!scrollContainer) {
      pendingViewportRestoreRef.current = null;
      return;
    }

    if (viewportRestore.mode === 'focal' && pageFigure) {
      const scrollContainerBox = scrollContainer.getBoundingClientRect();
      const pageFigureBox = pageFigure.getBoundingClientRect();
      const nextScrollPosition = getFocalScrollPosition({
        pageLeft: pageFigureBox.left,
        pageTop: pageFigureBox.top,
        pageWidth: pageFigureBox.width,
        pageHeight: pageFigureBox.height,
        pageOffsetXRatio: viewportRestore.pageOffsetXRatio,
        pageOffsetYRatio: viewportRestore.pageOffsetYRatio,
        midpoint: viewportRestore.midpoint,
        viewportLeft: scrollContainerBox.left,
        viewportTop: scrollContainerBox.top,
        scrollLeft: scrollContainer.scrollLeft,
        scrollTop: scrollContainer.scrollTop,
      });
      scrollContainer.scrollLeft = viewportRestore.preserveHorizontalScroll
        ? viewportRestore.scrollLeft
        : nextScrollPosition.left;
      scrollContainer.scrollTop = nextScrollPosition.top;
    } else if (viewportRestore.mode === 'preserve-scroll') {
      scrollContainer.scrollLeft = viewportRestore.scrollLeft;
      scrollContainer.scrollTop = viewportRestore.scrollTop;
    } else if (viewportRestore.mode === 'anchor' && pageFigure) {
      scrollContainer.scrollLeft = viewportRestore.scrollLeft;
      const scrollContainerBox = scrollContainer.getBoundingClientRect();
      const pageFigureBox = pageFigure.getBoundingClientRect();
      const pageTop =
        pageFigureBox.top - scrollContainerBox.top + scrollContainer.scrollTop;
      const nextScrollTop =
        pageTop +
        viewportRestore.pageOffsetRatio * Math.max(1, pageFigureBox.height);

      scrollContainer.scrollTop = nextScrollTop;
    } else {
      scrollContainer.scrollLeft = viewportRestore.scrollLeft;
      scrollContainer.scrollTop = viewportRestore.scrollTop;
    }
    pendingViewportRestoreRef.current = null;
    if (viewportRestore.mode === 'focal') {
      pendingLayoutRestoreRef.current = null;
    }
  }, [
    previewViewportWidth,
    readyPageStatuses,
    scrollContainerRef,
    state.kind,
    zoomLevel,
  ]);

  React.useEffect(() => {
    onSlideMetricsChange?.({
      currentSlideNumber,
      currentPageCount,
    });
  }, [currentPageCount, currentSlideNumber, onSlideMetricsChange]);
  return (
    <section
      className={`pdf-preview${readOnly ? ' pdf-preview--read-only' : ''}`}
      aria-label={title ? `PDF preview for ${title}` : 'PDF preview'}
    >
      <div className="pdf-preview-toolbar" aria-label="Annotation toolbar">
        <div className="pdf-preview-toolbar-row">
          <div className="pdf-preview-toolbar-actions">
            {onBackToAgenda ? (
              <IconButton
                label="Back to agenda"
                icon="back"
                title="Back to agenda (Alt+A)"
                onClick={() => {
                  void flushPersistenceSaveRef
                    .current()
                    .finally(onBackToAgenda);
                }}
              />
            ) : null}
            <IconButton
              label="Home"
              icon="home"
              title="Go to Slide 1"
              onClick={handleGoHome}
            />
            <IconButton
              label="Pen"
              icon="pen"
              onClick={() => setManualTool('pen')}
              pressed={manualTool === 'pen'}
            />
            <IconButton
              label="Text"
              icon="text"
              title="Text tool (Ctrl+T)"
              onClick={() => setManualTool('text')}
              pressed={manualTool === 'text'}
            />
            <IconButton
              label="Eraser"
              icon="eraser"
              onClick={() => setManualTool('eraser')}
              pressed={manualTool === 'eraser'}
            />
            <label className="pdf-preview-thickness-control">
              <span>Thickness</span>
              <input
                aria-label="Pen thickness"
                type="range"
                min="1"
                max="8"
                step="1"
                value={selectedPenThickness}
                onChange={(event) => {
                  const nextThickness = Number(event.target.value);
                  setSelectedPenThickness(nextThickness);
                  void onPenThicknessChange?.(nextThickness);
                }}
              />
              <output>{selectedPenThickness}px</output>
            </label>
            <div className="pdf-preview-color-control">
              <span>Color</span>
              <div className="pdf-preview-color-picker" ref={penColorPickerRef}>
                <button
                  type="button"
                  className="pdf-preview-color-trigger"
                  aria-label="Pen color"
                  aria-haspopup="listbox"
                  aria-expanded={isPenColorMenuOpen}
                  onClick={() => setIsPenColorMenuOpen((open) => !open)}
                >
                  <span
                    className="pdf-preview-color-swatch"
                    style={{ backgroundColor: selectedPenColor }}
                    aria-hidden="true"
                  />
                </button>
                {isPenColorMenuOpen ? (
                  <div
                    className="pdf-preview-color-menu"
                    role="listbox"
                    aria-label="Pen color choices"
                  >
                    {penColors.map((color, index) => (
                      <button
                        key={`${color}-${index}`}
                        type="button"
                        role="option"
                        aria-label={
                          DEFAULT_PEN_COLOR_NAMES[index] ?? `Color ${index + 1}`
                        }
                        aria-selected={selectedPenColor === color}
                        className={`pdf-preview-color-option${
                          selectedPenColor === color ? ' is-selected' : ''
                        }`}
                        onClick={() => {
                          setSelectedPenColor(color);
                          setIsPenColorMenuOpen(false);
                        }}
                      >
                        <span
                          className="pdf-preview-color-swatch"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          {workspaceMode && onWorkspaceModeChange ? (
            <SegmentedControl
              ariaLabel="Talk workspace"
              options={[
                { label: 'Slides', value: 'slides' as const },
                { label: 'Notes', value: 'notes' as const },
              ]}
              value={workspaceMode}
              onChange={onWorkspaceModeChange}
            />
          ) : null}
          <div className="pdf-preview-toolbar-actions">
            <IconButton
              label="Undo"
              icon="undo"
              onClick={handleUndo}
              disabled={!history.undo.length}
            />
            <IconButton
              label="Redo"
              icon="redo"
              onClick={handleRedo}
              disabled={!history.redo.length}
            />
          </div>
          <div className="pdf-preview-toolbar-actions">
            <IconButton
              label="Zoom out"
              icon="minus"
              onClick={() => handleZoomOut()}
            />
            <span className="pdf-preview-toolbar-zoom">
              {Math.round(displayZoomLevel * 100)}%
            </span>
            <IconButton
              label="Zoom in"
              icon="plus"
              onClick={() => handleZoomIn()}
            />
          </div>
        </div>
        {persistenceError ? (
          <div className="pdf-preview-toolbar-note pdf-preview-toolbar-note--error">
            {persistenceError}
          </div>
        ) : null}
      </div>

      <details
        className="pdf-preview-navigator"
        open={!isNavigatorCollapsed}
        onToggle={(event) => {
          setIsNavigatorCollapsed(!event.currentTarget.open);
        }}
      >
        <summary>
          Slide navigator
          <span className="pdf-preview-navigator-summary">
            <span className="pdf-preview-navigator-summary-label">
              Annotated
            </span>
            {(() => {
              const annotatedSlides = Array.from(
                { length: currentPageCount },
                (_, index) => index + 1,
              ).filter(
                (slideNumber) =>
                  (strokesByPage[slideNumber - 1]?.length ?? 0) > 0 ||
                  (textNotesByPage[slideNumber - 1]?.length ?? 0) > 0,
              );

              return annotatedSlides.length ? (
                annotatedSlides.map((slideNumber) => (
                  <button
                    key={slideNumber}
                    type="button"
                    className="pdf-preview-navigator-chip"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleJumpToSlideNumber(slideNumber);
                    }}
                  >
                    {slideNumber}
                  </button>
                ))
              ) : (
                <span className="pdf-preview-navigator-empty">
                  No annotated slides
                </span>
              );
            })()}
          </span>
        </summary>
        <div className="pdf-preview-navigator-grid">
          {Array.from({ length: currentPageCount }, (_, index) => {
            const annotated =
              (strokesByPage[index]?.length ?? 0) > 0 ||
              (textNotesByPage[index]?.length ?? 0) > 0;
            return (
              <button
                key={index}
                type="button"
                className={`pdf-preview-navigator-item${index + 1 === currentSlideNumber ? ' is-active' : ''}`}
                onClick={() => {
                  handleJumpToSlideNumber(index + 1);
                }}
              >
                <span>{index + 1}</span>
                {annotated ? (
                  <span className="pdf-preview-navigator-dot" />
                ) : null}
              </button>
            );
          })}
        </div>
      </details>

      <div
        ref={stageViewportRef}
        className="pdf-preview-stage"
        onWheel={(event) => {
          if (!event.ctrlKey) {
            return;
          }

          event.preventDefault();
          const midpoint = { x: event.clientX, y: event.clientY };
          if (event.deltaY < 0) {
            handleZoomIn(midpoint);
          } else {
            handleZoomOut(midpoint);
          }
        }}
      >
        {state.kind === 'loading' && !isRefreshingRenderedPages ? (
          <div className="pdf-preview-stage-status pdf-preview-stage-status--loading">
            <span className="pdf-preview-stage-spinner" aria-hidden="true" />
            <div className="pdf-preview-stage-status-copy">
              <strong>{state.label}</strong>
            </div>
          </div>
        ) : state.kind === 'error' ? (
          <div className="pdf-preview-stage-status pdf-preview-stage-status--error">
            <div className="pdf-preview-stage-status-copy">
              <strong>PDF preview unavailable</strong>
              <span>{state.label}</span>
            </div>
            {onRetryLoad ? (
              <button
                type="button"
                className="secondary-button"
                onClick={onRetryLoad}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {currentPageCount > 0 ? (
          <div
            ref={pdfPagesRef}
            className={`pdf-preview-pages${
              (state.kind === 'loading' && !isRefreshingRenderedPages) ||
              state.kind === 'error'
                ? ' is-rendering'
                : ''
            }`}
          >
            {Array.from({ length: currentPageCount }, (_, index) => {
              const pageSize = renderablePageSizes[index] ?? {
                width: 1,
                height: 1,
              };
              const pageDisplayScale =
                previewViewportWidth > 0 && pageSize.width > 0
                  ? (previewViewportWidth * zoomLevel) / pageSize.width
                  : 1;
              const displayWidth = Math.max(
                1,
                Math.round(pageSize.width * pageDisplayScale),
              );
              const displayHeight = Math.max(
                1,
                Math.round(pageSize.height * pageDisplayScale),
              );
              const pageStrokes = strokesByPage[index] ?? [];
              const pageTextNotes = textNotesByPage[index] ?? [];
              const pageLinks = linkHotspotsByPage[index] ?? [];
              const marker =
                pointerMarker?.pageIndex === index ? pointerMarker : null;
              const pageTextNoteDraft =
                textNoteDraft?.pageIndex === index ? textNoteDraft : null;
              const hasRenderablePageSize =
                pageSize.width > 0 && pageSize.height > 0;

              return (
                <MemoizedPdfPageFrame
                  key={index}
                  pageIndex={index}
                  displayWidth={displayWidth}
                  displayHeight={displayHeight}
                  pageSize={pageSize}
                  pageStrokes={pageStrokes}
                  pageTextNotes={pageTextNotes}
                  pageLinks={pageLinks}
                  marker={marker}
                  pageTextNoteDraft={pageTextNoteDraft}
                  renderedTool={pointerDiagnostics.renderedTool}
                  cursor={pointerDiagnostics.cursor}
                  overlayClass={pointerDiagnostics.overlayClass}
                  pageCanvasRefs={pageCanvasRefs}
                  pageFigureRefs={pageFigureRefs}
                  handlePagePointerEvent={handlePagePointerEvent}
                >
                  <canvas
                    ref={(element) => {
                      pageCanvasRefs.current[index] = element;
                    }}
                    className="pdf-preview-canvas"
                    style={{
                      width: `${displayWidth}px`,
                      height: `${displayHeight}px`,
                    }}
                    draggable={false}
                  />
                  <div
                    className="pdf-preview-link-layer"
                    aria-label={`Links on page ${index + 1}`}
                  >
                    {pageLinks.map((link, linkIndex) => (
                      <button
                        key={`${link.url}-${linkIndex}`}
                        type="button"
                        className="pdf-preview-link-hotspot"
                        aria-label={
                          link.label
                            ? `Link on page ${index + 1}: ${link.label}`
                            : `Link on page ${index + 1}`
                        }
                        style={{
                          left: `${link.rect.left}px`,
                          top: `${link.rect.top}px`,
                          width: `${Math.max(18, link.rect.width)}px`,
                          height: `${Math.max(18, link.rect.height)}px`,
                        }}
                        onPointerEnter={(event) => {
                          showLinkPopover(
                            index,
                            link,
                            event.clientX,
                            event.clientY,
                          );
                        }}
                        onPointerLeave={hideLinkPopoverOnPointerLeave}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          showLinkPopover(
                            index,
                            link,
                            event.clientX,
                            event.clientY,
                          );
                        }}
                        onFocus={(event) => {
                          const bounds =
                            event.currentTarget.getBoundingClientRect();
                          showLinkPopover(
                            index,
                            link,
                            bounds.left + bounds.width / 2,
                            bounds.top + bounds.height / 2,
                          );
                        }}
                        onBlur={hideLinkPopoverSoon}
                      />
                    ))}
                  </div>
                  <PdfInkLayer
                    pageIndex={index}
                    pageSize={pageSize}
                    displayWidth={displayWidth}
                    displayHeight={displayHeight}
                    strokes={pageStrokes}
                    canvasRefs={inkLayerCanvasRefs}
                    overlayClass={pointerDiagnostics.overlayClass}
                  />
                  {marker && hasRenderablePageSize ? (
                    <span
                      aria-hidden="true"
                      className={`pdf-preview-pointer-marker ${marker.tool}`}
                      style={{
                        left: `${marker.point.x * 100}%`,
                        top: `${marker.point.y * 100}%`,
                      }}
                    />
                  ) : null}
                  <div
                    className="pdf-preview-text-notes"
                    aria-label={`Text notes on page ${index + 1}`}
                  >
                    {pageTextNotes.map((note) => {
                      const isEditing =
                        textNoteDraft?.mode === 'edit' &&
                        textNoteDraft.pageIndex === index &&
                        textNoteDraft.noteId === note.id;
                      const displayedNote =
                        isEditing && textNoteDraft ? textNoteDraft : note;

                      return (
                        <article
                          key={note.id}
                          className="pdf-preview-text-note"
                          style={{
                            left: `${clamp01(displayedNote.x) * 100}%`,
                            top: `${clamp01(displayedNote.y) * 100}%`,
                            width: `${
                              clampTextNoteWidth(
                                displayedNote.width ?? DEFAULT_TEXT_NOTE_WIDTH,
                              ) * 100
                            }%`,
                          }}
                        >
                          <button
                            type="button"
                            className="pdf-preview-text-note-drag-handle"
                            aria-label={`Drag note on page ${index + 1}`}
                            onPointerDown={(event) =>
                              handleTextNoteDragStart(index, note, event)
                            }
                            title="Drag note"
                          >
                            <span
                              className="pdf-preview-text-note-grip"
                              aria-hidden="true"
                            />
                          </button>
                          {isEditing ? (
                            <textarea
                              className="pdf-preview-text-note-editor"
                              aria-label={`Note text on page ${index + 1}`}
                              ref={focusTextNoteEditor}
                              value={textNoteDraft.text}
                              onPointerDown={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                setTextNoteDraft((currentDraft) =>
                                  currentDraft
                                    ? {
                                        ...currentDraft,
                                        text: event.target.value,
                                      }
                                    : currentDraft,
                                )
                              }
                              onBlur={commitTextNoteDraft}
                              onKeyDown={handleTextNoteEditorKeyDown}
                              rows={3}
                            />
                          ) : (
                            <button
                              type="button"
                              className="pdf-preview-text-note-text"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={() => handleEditTextNote(index, note)}
                            >
                              {note.text}
                            </button>
                          )}
                          <div className="pdf-preview-text-note-actions">
                            <IconButton
                              label={`Delete note on page ${index + 1}`}
                              icon="trash"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={() =>
                                handleDeleteTextNote(index, note.id)
                              }
                            />
                          </div>
                          {isEditing ? (
                            <button
                              type="button"
                              className="pdf-preview-text-note-resize-handle"
                              aria-label={`Resize note on page ${index + 1}`}
                              onPointerDown={(event) =>
                                handleTextNoteResizeStart(index, event)
                              }
                              onPointerMove={(event) =>
                                handleTextNoteResizePointerEvent(
                                  index,
                                  'pointermove',
                                  event,
                                )
                              }
                              onPointerUp={(event) =>
                                handleTextNoteResizePointerEvent(
                                  index,
                                  'pointerup',
                                  event,
                                )
                              }
                              onPointerCancel={(event) =>
                                handleTextNoteResizePointerEvent(
                                  index,
                                  'pointercancel',
                                  event,
                                )
                              }
                            />
                          ) : null}
                        </article>
                      );
                    })}
                    {textNoteDraft?.mode === 'create' &&
                    textNoteDraft.pageIndex === index ? (
                      <article
                        className="pdf-preview-text-note"
                        style={{
                          left: `${clamp01(textNoteDraft.x) * 100}%`,
                          top: `${clamp01(textNoteDraft.y) * 100}%`,
                          width: `${clampTextNoteWidth(textNoteDraft.width) * 100}%`,
                        }}
                      >
                        <textarea
                          className="pdf-preview-text-note-editor"
                          aria-label={`Note text on page ${index + 1}`}
                          ref={focusTextNoteEditor}
                          value={textNoteDraft.text}
                          onPointerDown={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            setTextNoteDraft((currentDraft) =>
                              currentDraft
                                ? {
                                    ...currentDraft,
                                    text: event.target.value,
                                  }
                                : currentDraft,
                            )
                          }
                          onBlur={commitTextNoteDraft}
                          onKeyDown={handleTextNoteEditorKeyDown}
                          rows={3}
                          placeholder="Type your note"
                        />
                        <button
                          type="button"
                          className="pdf-preview-text-note-resize-handle"
                          aria-label={`Resize note on page ${index + 1}`}
                          onPointerDown={(event) =>
                            handleTextNoteResizeStart(index, event)
                          }
                          onPointerMove={(event) =>
                            handleTextNoteResizePointerEvent(
                              index,
                              'pointermove',
                              event,
                            )
                          }
                          onPointerUp={(event) =>
                            handleTextNoteResizePointerEvent(
                              index,
                              'pointerup',
                              event,
                            )
                          }
                          onPointerCancel={(event) =>
                            handleTextNoteResizePointerEvent(
                              index,
                              'pointercancel',
                              event,
                            )
                          }
                        />
                      </article>
                    ) : null}
                  </div>
                </MemoizedPdfPageFrame>
              );
            })}
          </div>
        ) : null}
      </div>

      {activeLinkPopover ? (
        <div
          className="pdf-preview-link-popover"
          role="toolbar"
          aria-label="Link actions"
          onPointerEnter={clearLinkPopoverHideTimer}
          onPointerLeave={hideLinkPopoverOnPointerLeave}
          style={{
            left: `${Math.max(
              12,
              Math.min(activeLinkPopover.x + 14, window.innerWidth - 292),
            )}px`,
            top: `${Math.max(
              12,
              Math.min(activeLinkPopover.y + 14, window.innerHeight - 140),
            )}px`,
          }}
        >
          <div className="pdf-preview-link-popover-label">
            {activeLinkPopover.link.label || activeLinkPopover.link.url}
          </div>
          <div className="pdf-preview-link-popover-actions">
            <IconButton
              label="Open link"
              title="Open"
              icon="open"
              onClick={() => {
                setActiveLinkPopover(null);
                void handleOpenLink(activeLinkPopover.link.url);
              }}
            />
            <IconButton
              label="Copy link"
              title="Copy"
              icon="copy"
              onClick={(event) => {
                setActiveLinkPopover(null);
                void handleCopyLink(
                  activeLinkPopover.link.url,
                  event,
                  'Copied to clipboard',
                );
              }}
            />
            {isLikelyDownloadableUrl(activeLinkPopover.link.url) ? (
              <IconButton
                label="Download link"
                title="Download"
                icon="export"
                onClick={() => {
                  setActiveLinkPopover(null);
                  void handleDownloadLink(activeLinkPopover.link.url);
                }}
              />
            ) : null}
            {activeLinkPopover.link.isIndicoEvent ? (
              <IconButton
                label="Open in IndicoInk"
                title="Open in IndicoInk"
                icon="event"
                onClick={() => {
                  setActiveLinkPopover(null);
                  void handleOpenLinkInIndicoInk(
                    parseIndicoEventUrl(activeLinkPopover.link.url)
                      ?.canonicalEventUrl ?? activeLinkPopover.link.url,
                  );
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}

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
  );
}
