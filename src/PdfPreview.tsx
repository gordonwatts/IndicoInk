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
  toNormalizedPagePoint,
  type NormalizedPagePoint,
  type PageSize,
} from './inkGeometry';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import {
  createStrokeSegmentList,
  strokeHitsPoint,
  type InkStroke,
} from './strokeTools';
import type { PdfWorkspaceSnapshot } from './shared/pdfWorkspace';
import type { PdfWorkspacePageState } from './shared/pdfWorkspace';
import { DialogSurface, IconButton, SegmentedControl } from './ui';
import {
  createConferenceId,
  createDeckId,
  createSlideId,
  createTalkId,
  type TextNote,
} from './persistenceModels';

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

type TextNoteDraft = {
  mode: 'create' | 'edit';
  pageIndex: number;
  noteId: string | null;
  x: number;
  y: number;
  text: string;
};

type TextNoteDragState = {
  pointerId: number;
  noteId: string;
  pageIndex: number;
  startOffsetX: number;
  startOffsetY: number;
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
      strokeId: string;
    }
  | {
      kind: 'erase';
      pointerId: number;
      pageIndex: number;
    }
  | {
      kind: 'text';
      pointerId: number;
      pageIndex: number;
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

type MouseMode = 'draw' | 'pan';
type ManualTool = 'pen' | 'text' | 'eraser';

const mouseModeOptions = [
  { label: 'Draw', value: 'draw' as const },
  { label: 'Pan', value: 'pan' as const },
];

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

const getRenderableStrokePoints = (stroke: InkStroke) =>
  Array.isArray(stroke.points) ? stroke.points : [];

const cloneWorkspaceHistory = (history: PdfWorkspacePageState[][]) =>
  history.map((snapshot) =>
    snapshot.map((pageState) => ({
      strokes: pageState.strokes.map((stroke) => ({
        ...stroke,
        points: [...stroke.points],
      })),
      textNotes: pageState.textNotes.map((note) => ({ ...note })),
    })),
  );

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
  pageSize: PageSize,
): NormalizedPagePoint => {
  const canvas = event.currentTarget.querySelector<HTMLCanvasElement>(
    '.pdf-preview-canvas',
  );
  const bounds =
    canvas?.getBoundingClientRect() ??
    event.currentTarget.getBoundingClientRect();
  const relativePoint = {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
    pressure: event.pressure,
    time: event.timeStamp,
  };

  return toNormalizedPagePoint(relativePoint, pageSize);
};

const createStrokeId = () =>
  `stroke-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

const createTextNoteId = () =>
  `text-note-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const getScrollViewportElement = (
  scrollContainerRef?: React.RefObject<HTMLElement | null>,
) =>
  scrollContainerRef?.current ??
  document.querySelector<HTMLElement>('.page-surface') ??
  document.documentElement;

type PdfPreviewProps = {
  filePath: string | null;
  title?: string;
  conferenceId?: string | null;
  talkId?: string | null;
  workspaceDeckId?: string | null;
  onRetryLoad?: () => void;
  onSlideMetricsChange?: (metrics: {
    currentSlideNumber: number;
    currentPageCount: number;
  }) => void;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
};

export function PdfPreview({
  filePath,
  title,
  conferenceId = null,
  talkId = null,
  workspaceDeckId = null,
  onRetryLoad,
  onSlideMetricsChange,
  scrollContainerRef,
}: PdfPreviewProps) {
  const [state, setState] = React.useState<PdfPreviewState>({ kind: 'idle' });
  const [mouseMode, setMouseMode] = React.useState<MouseMode>('draw');
  const [manualTool, setManualTool] = React.useState<ManualTool>('pen');
  const [pointerDiagnostics, setPointerDiagnostics] =
    React.useState<PointerDiagnostics>(createIdlePointerDiagnostics());
  const pageCanvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const stageViewportRef = React.useRef<HTMLDivElement | null>(null);
  const latchedToolRef = React.useRef<PointerTool | null>(null);
  const activeInkActionRef = React.useRef<ActiveInkAction>(null);
  const [strokesByPage, setStrokesByPage] = React.useState<Array<InkStroke[]>>(
    [],
  );
  const [textNotesByPage, setTextNotesByPage] = React.useState<
    Array<TextNote[]>
  >([]);
  const [undoStack, setUndoStack] = React.useState<
    Array<PdfWorkspacePageState[]>
  >([]);
  const [redoStack, setRedoStack] = React.useState<
    Array<PdfWorkspacePageState[]>
  >([]);
  const [textNoteDraft, setTextNoteDraft] =
    React.useState<TextNoteDraft | null>(null);
  const [textNoteDragState, setTextNoteDragState] =
    React.useState<TextNoteDragState | null>(null);
  const [pointerMarker, setPointerMarker] =
    React.useState<PointerMarker | null>(null);
  const [persistenceError, setPersistenceError] = React.useState<string | null>(
    null,
  );
  const pointerDiagnosticsFrameRef = React.useRef<number | null>(null);
  const pendingPointerDiagnosticsRef = React.useRef<PointerDiagnostics | null>(
    null,
  );
  const persistenceSaveTimerRef = React.useRef<number | null>(null);
  const persistenceHydratedRef = React.useRef(false);
  const pendingWorkspaceRestoreRef = React.useRef<PdfWorkspaceSnapshot | null>(
    null,
  );
  const pendingLayoutRestoreRef = React.useRef<{
    scrollLeft: number;
    scrollTop: number;
    currentSlideNumber: number;
  } | null>(null);
  const pendingViewportRestoreRef = React.useRef<{
    mode: 'anchor' | 'preserve-scroll';
    pageIndex: number;
    pageOffsetRatio: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const currentSlideNumberRef = React.useRef(1);
  const pageFigureRefs = React.useRef<Array<HTMLElement | null>>([]);
  const [zoomLevel, setZoomLevel] = React.useState(1);
  const [previewViewportWidth, setPreviewViewportWidth] = React.useState(0);
  const [currentSlideNumber, setCurrentSlideNumber] = React.useState(1);
  const [isNavigatorCollapsed, setIsNavigatorCollapsed] = React.useState(true);
  const lastRenderedZoomRef = React.useRef(zoomLevel);

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

  React.useEffect(() => {
    const viewportElement =
      scrollContainerRef?.current ?? stageViewportRef.current;
    if (!viewportElement) {
      return;
    }

    const updateWidth = () => {
      const style = window.getComputedStyle(viewportElement);
      const horizontalPadding =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const nextWidth = Math.max(
        0,
        Math.floor(viewportElement.clientWidth - horizontalPadding),
      );
      setPreviewViewportWidth((currentWidth) => {
        if (currentWidth !== nextWidth && currentWidth > 0) {
          const anchor = captureViewportAnchor();
          pendingViewportRestoreRef.current =
            nextWidth > currentWidth && nextWidth >= renderedPageWidth
              ? {
                  mode: 'preserve-scroll',
                  pageIndex: Math.max(0, currentSlideNumberRef.current - 1),
                  pageOffsetRatio: 0,
                  scrollLeft: viewportElement.scrollLeft,
                  scrollTop: viewportElement.scrollTop,
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
    observer.observe(viewportElement);

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

      const interactionMode =
        toolState.renderedTool === 'touch'
          ? 'pan'
          : manualTool === 'text'
            ? 'text'
            : toolState.renderedTool === 'mouse'
              ? mouseMode === 'pan'
                ? 'pan'
                : manualInteractionMode
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
    [manualTool, mouseMode],
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
    },
    [],
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
      setStrokesByPage((currentPages) =>
        currentPages.map((pageStrokes, currentIndex) =>
          currentIndex === pageIndex ? updater(pageStrokes) : pageStrokes,
        ),
      );
    },
    [],
  );

  const updateTextNotePage = React.useCallback(
    (
      pageIndex: number,
      updater: (currentTextNotes: TextNote[]) => TextNote[],
    ) => {
      setTextNotesByPage((currentPages) =>
        currentPages.map((pageTextNotes, currentIndex) =>
          currentIndex === pageIndex ? updater(pageTextNotes) : pageTextNotes,
        ),
      );
    },
    [],
  );

  const recordWorkspaceSnapshot = React.useCallback(() => {
    setUndoStack((currentUndoStack) => [
      strokesByPage.map((pageStrokes, pageIndex) => ({
        strokes: pageStrokes.map((stroke) => ({
          ...stroke,
          points: [...stroke.points],
        })),
        textNotes: (textNotesByPage[pageIndex] ?? []).map((note) => ({
          ...note,
        })),
      })),
      ...currentUndoStack,
    ]);
    setRedoStack([]);
  }, [strokesByPage, textNotesByPage]);

  const handleUndo = React.useCallback(() => {
    const previousPages = undoStack[0];
    if (!previousPages) {
      return;
    }

    const rest = undoStack.slice(1);
    setRedoStack((currentRedoStack) => [
      strokesByPage.map((pageStrokes, pageIndex) => ({
        strokes: pageStrokes.map((stroke) => ({
          ...stroke,
          points: [...stroke.points],
        })),
        textNotes: (textNotesByPage[pageIndex] ?? []).map((note) => ({
          ...note,
        })),
      })),
      ...currentRedoStack,
    ]);
    setUndoStack(rest);
    setStrokesByPage(previousPages.map((pageState) => pageState.strokes));
    setTextNotesByPage(previousPages.map((pageState) => pageState.textNotes));
  }, [strokesByPage, textNotesByPage, undoStack]);

  const handleRedo = React.useCallback(() => {
    const nextPages = redoStack[0];
    if (!nextPages) {
      return;
    }

    const rest = redoStack.slice(1);
    setUndoStack((currentUndoStack) => [
      strokesByPage.map((pageStrokes, pageIndex) => ({
        strokes: pageStrokes.map((stroke) => ({
          ...stroke,
          points: [...stroke.points],
        })),
        textNotes: (textNotesByPage[pageIndex] ?? []).map((note) => ({
          ...note,
        })),
      })),
      ...currentUndoStack,
    ]);
    setRedoStack(rest);
    setStrokesByPage(nextPages.map((pageState) => pageState.strokes));
    setTextNotesByPage(nextPages.map((pageState) => pageState.textNotes));
  }, [redoStack, strokesByPage, textNotesByPage]);

  const currentPageCount =
    state.kind === 'loading' || state.kind === 'ready' || state.kind === 'error'
      ? state.pageCount
      : 0;
  const readyPageStatuses =
    state.kind === 'ready' ? state.pageStatuses : undefined;
  const renderablePageSizes =
    state.kind === 'loading' || state.kind === 'ready' || state.kind === 'error'
      ? state.pageSizes
      : [];
  const renderedPageWidth =
    renderablePageSizes.reduce(
      (maximumWidth, pageSize) => Math.max(maximumWidth, pageSize.width),
      0,
    ) || 1;
  const pageDisplayScale =
    state.kind === 'idle'
      ? 1
      : Math.min(1, previewViewportWidth / renderedPageWidth);

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

    recordWorkspaceSnapshot();

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
      text: trimmedText,
      createdAt: now,
      updatedAt: now,
    };

    const nextTextNotesByPage = textNotesByPage.length
      ? textNotesByPage.map((pageNotes, pageIndex) => {
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

    setTextNotesByPage(nextTextNotesByPage);

    const nextSnapshot: PdfWorkspaceSnapshot = {
      sourceUrl: filePath ?? '',
      pageCount: currentPageCount,
      strokesByPage,
      textNotesByPage: nextTextNotesByPage,
      undoStack,
      redoStack,
      currentSlideNumber: currentSlideNumberRef.current,
      scrollLeft: getScrollViewportElement(scrollContainerRef).scrollLeft,
      scrollTop: getScrollViewportElement(scrollContainerRef).scrollTop,
      zoom: zoomLevel,
      ...(workspaceDeckId && conferenceId ? { conferenceId } : {}),
      ...(workspaceDeckId && talkId ? { talkId } : {}),
      ...(workspaceDeckId ? { deckId: workspaceDeckId } : {}),
    };

    const saveWorkspace = workspaceDeckId
      ? window.indicoInk.saveDeckWorkspaceState(nextSnapshot)
      : window.indicoInk.savePdfWorkspaceState(nextSnapshot);

    void saveWorkspace
      .then(() => {
        setPersistenceError(null);
      })
      .catch((error) => {
        setPersistenceError(
          error instanceof Error ? error.message : 'Failed to save workspace.',
        );
      });

    closeTextNoteDraft();
  }, [
    closeTextNoteDraft,
    conferenceId,
    currentPageCount,
    filePath,
    redoStack,
    state.kind,
    strokesByPage,
    talkId,
    textNoteDraft,
    recordWorkspaceSnapshot,
    textNotesByPage,
    undoStack,
    zoomLevel,
    workspaceDeckId,
  ]);

  const handleDeleteTextNote = React.useCallback(
    (pageIndex: number, noteId: string) => {
      recordWorkspaceSnapshot();
      updateTextNotePage(pageIndex, (currentTextNotes) =>
        currentTextNotes.filter((note) => note.id !== noteId),
      );
      if (textNoteDraft?.noteId === noteId) {
        closeTextNoteDraft();
      }
    },
    [
      closeTextNoteDraft,
      recordWorkspaceSnapshot,
      textNoteDraft,
      updateTextNotePage,
    ],
  );

  const handleEditTextNote = React.useCallback(
    (pageIndex: number, note: TextNote) => {
      recordWorkspaceSnapshot();
      setTextNoteDraft({
        mode: 'edit',
        noteId: note.id,
        pageIndex,
        x: note.x,
        y: note.y,
        text: note.text,
      });
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

      recordWorkspaceSnapshot();
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setTextNoteDragState({
        pointerId: event.pointerId,
        noteId: note.id,
        pageIndex,
        startOffsetX: event.clientX - noteRect.left,
        startOffsetY: event.clientY - noteRect.top,
      });
    },
    [recordWorkspaceSnapshot],
  );

  const handleZoomIn = React.useCallback(() => {
    setZoomLevel((currentZoom) =>
      Math.min(2.5, Number((currentZoom + 0.15).toFixed(2))),
    );
  }, []);

  const handleZoomOut = React.useCallback(() => {
    setZoomLevel((currentZoom) =>
      Math.max(0.5, Number((currentZoom - 0.15).toFixed(2))),
    );
  }, []);

  const handleJumpToSlideNumber = React.useCallback((pageNumber: number) => {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      return;
    }

    const pageIndex = pageNumber - 1;
    const target = pageFigureRefs.current[pageIndex];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    currentSlideNumberRef.current = pageNumber;
    setCurrentSlideNumber(pageNumber);
  }, []);

  const handleGoHome = React.useCallback(() => {
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
  }, [scrollContainerRef]);

  const schedulePersistenceSave = React.useCallback(() => {
    if (
      !filePath ||
      state.kind !== 'ready' ||
      !persistenceHydratedRef.current
    ) {
      return;
    }

    if (persistenceSaveTimerRef.current !== null) {
      window.clearTimeout(persistenceSaveTimerRef.current);
    }

    persistenceSaveTimerRef.current = window.setTimeout(() => {
      persistenceSaveTimerRef.current = null;

      if (
        !filePath ||
        state.kind !== 'ready' ||
        !persistenceHydratedRef.current
      ) {
        return;
      }

      const snapshot: PdfWorkspaceSnapshot = {
        sourceUrl: filePath,
        pageCount: currentPageCount,
        strokesByPage,
        textNotesByPage,
        undoStack,
        redoStack,
        currentSlideNumber: currentSlideNumberRef.current,
        scrollLeft: getScrollViewportElement(scrollContainerRef).scrollLeft,
        scrollTop: getScrollViewportElement(scrollContainerRef).scrollTop,
        zoom: zoomLevel,
        ...(workspaceDeckId && conferenceId ? { conferenceId } : {}),
        ...(workspaceDeckId && talkId ? { talkId } : {}),
        ...(workspaceDeckId ? { deckId: workspaceDeckId } : {}),
      };

      const saveWorkspace = workspaceDeckId
        ? window.indicoInk.saveDeckWorkspaceState(snapshot)
        : window.indicoInk.savePdfWorkspaceState(snapshot);

      void saveWorkspace
        .then(() => {
          setPersistenceError(null);
        })
        .catch((error) => {
          setPersistenceError(
            error instanceof Error
              ? error.message
              : 'Failed to save workspace.',
          );
        });
    }, 400);
  }, [
    currentPageCount,
    filePath,
    state.kind,
    strokesByPage,
    textNotesByPage,
    undoStack,
    redoStack,
    workspaceDeckId,
    zoomLevel,
  ]);

  React.useEffect(() => {
    if (
      !filePath ||
      state.kind !== 'ready' ||
      !persistenceHydratedRef.current
    ) {
      return;
    }

    schedulePersistenceSave();
  }, [
    filePath,
    schedulePersistenceSave,
    state.kind,
    strokesByPage,
    textNotesByPage,
  ]);

  React.useEffect(
    () => () => {
      if (persistenceSaveTimerRef.current !== null) {
        window.clearTimeout(persistenceSaveTimerRef.current);
        persistenceSaveTimerRef.current = null;
      }
    },
    [],
  );

  const handlePagePointerEvent = React.useCallback(
    (pageIndex: number, eventKind: PointerEventKind) =>
      (event: React.PointerEvent<HTMLDivElement>) => {
        const pageSize =
          state.kind === 'loading' || state.kind === 'ready'
            ? state.pageSizes[pageIndex]
            : undefined;

        const resolution = handlePointerEvent(eventKind)(event);

        const pagePoint =
          pageSize && pageSize.width > 0 && pageSize.height > 0
            ? getPagePoint(event, pageSize)
            : null;
        const { interactionMode, renderedTool } = resolution;
        const isStylusTool =
          resolution.toolState.resolvedTool === 'pen' ||
          resolution.toolState.resolvedTool === 'eraser';
        const shouldShowMarker =
          pagePoint !== null &&
          isStylusTool &&
          (interactionMode === 'draw' || interactionMode === 'erase');

        if (shouldShowMarker) {
          setPointerMarker({
            pageIndex,
            point: pagePoint,
            tool: renderedTool === 'eraser' ? 'eraser' : 'pen',
          });
        } else {
          setPointerMarker(null);
        }

        if (eventKind === 'pointerdown') {
          currentSlideNumberRef.current = pageIndex + 1;

          if (interactionMode === 'text' && pagePoint) {
            event.preventDefault();
            const noteId = createTextNoteId();
            activeInkActionRef.current = {
              kind: 'text',
              pointerId: event.pointerId,
              pageIndex,
            };
            setTextNoteDraft({
              mode: 'create',
              noteId,
              pageIndex,
              x: pagePoint.x,
              y: pagePoint.y,
              text: '',
            });
            return;
          }

          if (interactionMode === 'draw' && pagePoint) {
            event.preventDefault();
            recordWorkspaceSnapshot();
            const strokeId = createStrokeId();
            activeInkActionRef.current = {
              kind: 'draw',
              pointerId: event.pointerId,
              pageIndex,
              strokeId,
            };
            setStrokesByPage((currentPages) => {
              const nextPages = currentPages.length
                ? [...currentPages]
                : createEmptyStrokePages(
                    state.kind === 'loading' || state.kind === 'ready'
                      ? state.pageCount
                      : 0,
                  );
              const currentPageStrokes = nextPages[pageIndex] ?? [];
              nextPages[pageIndex] = [
                ...currentPageStrokes,
                {
                  id: strokeId,
                  pageNumber: pageIndex + 1,
                  points: [pagePoint],
                },
              ];
              return nextPages;
            });
            return;
          }

          if (interactionMode === 'erase' && pagePoint && pageSize) {
            event.preventDefault();
            recordWorkspaceSnapshot();
            activeInkActionRef.current = {
              kind: 'erase',
              pointerId: event.pointerId,
              pageIndex,
            };
            setStrokesByPage((currentPages) => {
              const nextPages = currentPages.length
                ? [...currentPages]
                : createEmptyStrokePages(
                    state.kind === 'loading' || state.kind === 'ready'
                      ? state.pageCount
                      : 0,
                  );
              nextPages[pageIndex] = (nextPages[pageIndex] ?? []).filter(
                (stroke) => !strokeHitsPoint(stroke, pagePoint, pageSize),
              );
              return nextPages;
            });
            return;
          }

          const scrollContainer = getScrollViewportElement(scrollContainerRef);
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
          if (
            activeInkActionRef.current.kind === 'draw' &&
            activeInkActionRef.current.pageIndex === pageIndex &&
            pagePoint
          ) {
            event.preventDefault();
            const currentStrokeId = activeInkActionRef.current.strokeId;
            updateStrokePage(pageIndex, (currentStrokes) =>
              currentStrokes.map((stroke) =>
                stroke.id === currentStrokeId
                  ? { ...stroke, points: [...stroke.points, pagePoint] }
                  : stroke,
              ),
            );
          }

          if (
            activeInkActionRef.current.kind === 'erase' &&
            activeInkActionRef.current.pageIndex === pageIndex &&
            pagePoint &&
            pageSize
          ) {
            event.preventDefault();
            updateStrokePage(pageIndex, (currentStrokes) =>
              currentStrokes.filter(
                (stroke) => !strokeHitsPoint(stroke, pagePoint, pageSize),
              ),
            );
          }

          if (
            activeInkActionRef.current.kind === 'pan' &&
            activeInkActionRef.current.pointerId === event.pointerId &&
            getScrollViewportElement(scrollContainerRef)
          ) {
            const scrollContainer =
              getScrollViewportElement(scrollContainerRef);
            const deltaX =
              event.clientX - activeInkActionRef.current.startClientX;
            const deltaY =
              event.clientY - activeInkActionRef.current.startClientY;

            scrollContainer.scrollLeft =
              activeInkActionRef.current.startScrollLeft - deltaX;
            scrollContainer.scrollTop =
              activeInkActionRef.current.startScrollTop - deltaY;
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
          event.preventDefault();
        }

        if (eventKind === 'pointerup' || eventKind === 'pointercancel') {
          const activeInkAction = activeInkActionRef.current;
          if (
            activeInkAction?.pointerId === event.pointerId &&
            (activeInkAction.kind === 'pan' ||
              activeInkAction.kind === 'text' ||
              activeInkAction.pageIndex === pageIndex)
          ) {
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
            textNoteDragState.pageIndex === pageIndex
          ) {
            setTextNoteDragState(null);
          }
        }
      },
    [
      handlePointerEvent,
      pointerMarker,
      resolvePointerInteraction,
      state,
      recordWorkspaceSnapshot,
      textNoteDragState,
      updateStrokePage,
      updateTextNotePage,
      scrollContainerRef,
    ],
  );

  React.useEffect(() => {
    const scrollContainer = getScrollViewportElement(scrollContainerRef);
    if (!scrollContainer) {
      return;
    }

    const handleScroll = () => {
      if (
        !filePath ||
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
  }, [filePath, schedulePersistenceSave, scrollContainerRef, state.kind]);

  React.useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    if (!filePath) {
      pageCanvasRefs.current = [];
      setState({ kind: 'idle' });
      setStrokesByPage([]);
      setTextNotesByPage([]);
      setUndoStack([]);
      setRedoStack([]);
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

    if (
      (state.kind === 'ready' || state.kind === 'loading') &&
      zoomLevel === lastRenderedZoomRef.current &&
      previewViewportWidth > 0 &&
      renderedPageWidth > 0 &&
      previewViewportWidth < renderedPageWidth
    ) {
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
      setPointerDiagnostics(createIdlePointerDiagnostics());
      if (!filePath) {
        pageCanvasRefs.current = [];
        setState({ kind: 'idle' });
        setStrokesByPage([]);
        setTextNotesByPage([]);
        setUndoStack([]);
        setRedoStack([]);
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
      if (state.kind === 'ready' || state.kind === 'loading') {
        pendingLayoutRestoreRef.current = {
          scrollLeft: currentScrollContainer.scrollLeft,
          scrollTop: currentScrollContainer.scrollTop,
          currentSlideNumber: currentSlideNumberRef.current,
        };
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
      persistenceHydratedRef.current = false;
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
        pageCanvasRefs.current = Array.from({ length: pageCount }, () => null);
        pageFigureRefs.current = Array.from({ length: pageCount }, () => null);
        setStrokesByPage(createEmptyStrokePages(pageCount));
        setTextNotesByPage(createEmptyTextNotePages(pageCount));
        setUndoStack([]);
        setRedoStack([]);
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

        persistenceHydratedRef.current = false;
        const savedWorkspace = workspaceDeckId
          ? await window.indicoInk.loadDeckWorkspaceState(workspaceDeckId)
          : await window.indicoInk.loadPdfWorkspaceState(filePath);
        if (cancelled) {
          return;
        }

        if (savedWorkspace) {
          setStrokesByPage(
            savedWorkspace.strokesByPage.length
              ? savedWorkspace.strokesByPage
              : createEmptyStrokePages(pageCount),
          );
          setTextNotesByPage(
            savedWorkspace.textNotesByPage?.length
              ? savedWorkspace.textNotesByPage
              : createEmptyTextNotePages(pageCount),
          );
          setUndoStack(
            savedWorkspace.undoStack
              ? cloneWorkspaceHistory(savedWorkspace.undoStack)
              : [],
          );
          setRedoStack(
            savedWorkspace.redoStack
              ? cloneWorkspaceHistory(savedWorkspace.redoStack)
              : [],
          );
          pendingWorkspaceRestoreRef.current = savedWorkspace;
        } else {
          setStrokesByPage(createEmptyStrokePages(pageCount));
          setTextNotesByPage(createEmptyTextNotePages(pageCount));
          setUndoStack([]);
          setRedoStack([]);
          pendingWorkspaceRestoreRef.current = null;
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
          const context = canvas?.getContext('2d');
          if (!canvas || !context) {
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

          canvas.width = Math.floor(width * scale);
          canvas.height = Math.floor(height * scale);
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
          context.setTransform(scale, 0, 0, scale, 0, 0);

          await page.render({
            canvas,
            canvasContext: context,
            viewport,
          }).promise;

          pageSizes[pageNumber - 1] = { width, height };
          pageStatuses[pageNumber - 1] = 'ready';
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
            nextPageSizes[pageNumber - 1] = { width, height };
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

        if (!cancelled) {
          setState((currentState) =>
            currentState.kind === 'loading' || currentState.kind === 'ready'
              ? {
                  kind: 'ready',
                  label: 'Slides ready.',
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
                  kind: 'ready',
                  label: 'Slides ready.',
                  pageCount,
                  pageSizes,
                  pageStatuses,
                },
          );
          setPersistenceError(null);
          lastRenderedZoomRef.current = zoomLevel;
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
  }, [filePath, previewViewportWidth, workspaceDeckId, zoomLevel]);

  React.useEffect(() => {
    if (state.kind !== 'ready' || !filePath) {
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
      const scrollContainer = getScrollViewportElement(scrollContainerRef);
      if (scrollContainer) {
        scrollContainer.scrollLeft = restore.scrollLeft;
        scrollContainer.scrollTop = restore.scrollTop;
      }

      currentSlideNumberRef.current = restore.currentSlideNumber;
      setCurrentSlideNumber(restore.currentSlideNumber);
      setZoomLevel(restore.zoom || 1);
      pendingWorkspaceRestoreRef.current = null;
      pendingLayoutRestoreRef.current = null;
      persistenceHydratedRef.current = true;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [filePath, readyPageStatuses, scrollContainerRef, state.kind]);

  React.useEffect(() => {
    const viewportRestore = pendingViewportRestoreRef.current;
    if (!viewportRestore || previewViewportWidth <= 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const scrollContainer = getScrollViewportElement(scrollContainerRef);
      const pageFigure = pageFigureRefs.current[viewportRestore.pageIndex];
      if (!scrollContainer) {
        pendingViewportRestoreRef.current = null;
        return;
      }

      scrollContainer.scrollLeft = viewportRestore.scrollLeft;
      if (viewportRestore.mode === 'preserve-scroll') {
        scrollContainer.scrollTop = viewportRestore.scrollTop;
      } else if (pageFigure) {
        const scrollContainerBox = scrollContainer.getBoundingClientRect();
        const pageFigureBox = pageFigure.getBoundingClientRect();
        const pageTop =
          pageFigureBox.top - scrollContainerBox.top + scrollContainer.scrollTop;
        const nextScrollTop =
          pageTop +
          viewportRestore.pageOffsetRatio * Math.max(1, pageFigureBox.height);

        scrollContainer.scrollTop = nextScrollTop;
      } else {
        scrollContainer.scrollTop = viewportRestore.scrollTop;
      }
      pendingViewportRestoreRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [previewViewportWidth, scrollContainerRef, state.kind]);

  React.useEffect(() => {
    onSlideMetricsChange?.({
      currentSlideNumber,
      currentPageCount,
    });
  }, [currentPageCount, currentSlideNumber, onSlideMetricsChange]);
  return (
    <section
      className="pdf-preview"
      aria-label={title ? `PDF preview for ${title}` : 'PDF preview'}
    >
      <div className="pdf-preview-toolbar" aria-label="Annotation toolbar">
        <div className="pdf-preview-toolbar-row">
          <div className="pdf-preview-toolbar-actions">
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
              onClick={() => setManualTool('text')}
              pressed={manualTool === 'text'}
            />
            <IconButton
              label="Eraser"
              icon="eraser"
              onClick={() => setManualTool('eraser')}
              pressed={manualTool === 'eraser'}
            />
          </div>
          <SegmentedControl
            options={mouseModeOptions}
            value={mouseMode}
            onChange={setMouseMode}
          />
          <div className="pdf-preview-toolbar-actions">
            <IconButton
              label="Undo"
              icon="undo"
              onClick={handleUndo}
              disabled={!undoStack.length}
            />
            <IconButton
              label="Redo"
              icon="redo"
              onClick={handleRedo}
              disabled={!redoStack.length}
            />
          </div>
          <div className="pdf-preview-toolbar-actions">
            <IconButton label="Zoom out" icon="minus" onClick={handleZoomOut} />
            <span className="pdf-preview-toolbar-zoom">
              {Math.round(zoomLevel * 100)}%
            </span>
            <IconButton label="Zoom in" icon="plus" onClick={handleZoomIn} />
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
          if (event.deltaY < 0) {
            handleZoomIn();
          } else {
            handleZoomOut();
          }
        }}
      >
        {state.kind === 'loading' ? (
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
            className={`pdf-preview-pages${
              state.kind === 'loading' || state.kind === 'error'
                ? ' is-rendering'
                : ''
            }`}
          >
            {Array.from({ length: currentPageCount }, (_, index) => {
              const pageSize = renderablePageSizes[index] ?? {
                width: 1,
                height: 1,
              };
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
              const marker =
                pointerMarker?.pageIndex === index ? pointerMarker : null;
              const hasRenderablePageSize =
                pageSize.width > 0 && pageSize.height > 0;
              const strokeSegments = hasRenderablePageSize
                ? pageStrokes.flatMap((stroke) => {
                    const strokePoints = getRenderableStrokePoints(stroke);

                    if (strokePoints.length === 1) {
                      const point = strokePoints[0]!;

                      return [
                        <circle
                          key={`${stroke.id}-point`}
                          cx={point.x * pageSize.width}
                          cy={point.y * pageSize.height}
                          r={point.pressure > 0 ? 2.5 + point.pressure * 2 : 3}
                          fill="#111111"
                        />,
                      ];
                    }

                    return createStrokeSegmentList(strokePoints, pageSize).map(
                      (segment, segmentIndex) => (
                        <line
                          key={`${stroke.id}-${segmentIndex}`}
                          x1={segment.x1}
                          y1={segment.y1}
                          x2={segment.x2}
                          y2={segment.y2}
                          stroke="#111111"
                          strokeWidth={segment.width}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ),
                    );
                  })
                : [];

              return (
                <figure
                  key={index}
                  className="pdf-preview-page"
                  ref={(element) => {
                    pageFigureRefs.current[index] = element;
                  }}
                  style={{
                    width: `${displayWidth}px`,
                    height: `${displayHeight}px`,
                  }}
                >
                  <div
                    className="pdf-preview-sheet"
                    data-rendered-tool={pointerDiagnostics.renderedTool}
                    draggable={false}
                    style={{
                      cursor: pointerDiagnostics.cursor,
                      width: `${displayWidth}px`,
                      height: `${displayHeight}px`,
                    }}
                    onPointerMove={handlePagePointerEvent(index, 'pointermove')}
                    onPointerDown={handlePagePointerEvent(index, 'pointerdown')}
                    onPointerUp={handlePagePointerEvent(index, 'pointerup')}
                    onPointerCancel={handlePagePointerEvent(
                      index,
                      'pointercancel',
                    )}
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
                    <svg
                      aria-hidden="true"
                      className={`pdf-preview-overlay ${pointerDiagnostics.overlayClass}`}
                      viewBox={`0 0 ${pageSize.width || 1} ${pageSize.height || 1}`}
                      preserveAspectRatio="none"
                    >
                      {strokeSegments}
                      {marker && hasRenderablePageSize ? (
                        marker.tool === 'pen' ? (
                          <circle
                            key="pointer-marker"
                            cx={marker.point.x * pageSize.width}
                            cy={marker.point.y * pageSize.height}
                            r="5"
                            className="pdf-preview-pointer-marker pen"
                          />
                        ) : (
                          <rect
                            key="pointer-marker"
                            x={marker.point.x * pageSize.width - 6}
                            y={marker.point.y * pageSize.height - 6}
                            width="12"
                            height="12"
                            rx="3"
                            className="pdf-preview-pointer-marker eraser"
                          />
                        )
                      ) : null}
                    </svg>
                    <div
                      className="pdf-preview-text-notes"
                      aria-label={`Text notes on page ${index + 1}`}
                    >
                      {pageTextNotes.map((note) => (
                        <article
                          key={note.id}
                          className="pdf-preview-text-note"
                          style={{
                            left: `${clamp01(note.x) * 100}%`,
                            top: `${clamp01(note.y) * 100}%`,
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
                          <div className="pdf-preview-text-note-text">
                            {note.text}
                          </div>
                          <div className="pdf-preview-text-note-actions">
                            <IconButton
                              label={`Edit note on page ${index + 1}`}
                              icon="pen"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={() => handleEditTextNote(index, note)}
                            />
                            <IconButton
                              label={`Delete note on page ${index + 1}`}
                              icon="trash"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={() =>
                                handleDeleteTextNote(index, note.id)
                              }
                            />
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </figure>
              );
            })}
          </div>
        ) : null}
        {state.kind === 'loading' ? (
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
      </div>

      {textNoteDraft ? (
        <div className="pdf-preview-note-dialog">
          <DialogSurface
            title={textNoteDraft.mode === 'edit' ? 'Edit note' : 'Add note'}
            body={
              <label className="field pdf-preview-note-field">
                <span>Note text</span>
                <textarea
                  value={textNoteDraft.text}
                  onChange={(event) =>
                    setTextNoteDraft((currentDraft) =>
                      currentDraft
                        ? { ...currentDraft, text: event.target.value }
                        : currentDraft,
                    )
                  }
                  rows={4}
                  placeholder="Type your note"
                />
              </label>
            }
            primaryLabel={
              textNoteDraft.mode === 'edit' ? 'Save note' : 'Add note'
            }
            secondaryLabel="Cancel"
            onPrimary={commitTextNoteDraft}
            onSecondary={closeTextNoteDraft}
          />
        </div>
      ) : null}
    </section>
  );
}
