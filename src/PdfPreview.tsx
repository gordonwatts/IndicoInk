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
  getStrokeWidth,
  strokeHitsPoint,
  type InkStroke,
} from './strokeTools';
import { getPdfWorkerSrc } from './pdfjs';
import type { PdfWorkspaceSnapshot } from './shared/pdfWorkspace';
import type { PdfWorkspacePageState } from './shared/pdfWorkspace';
import type { AgendaTalkMaterialSummary } from './shared/agenda';
import type { DeckCacheDownloadStatus } from './shared/deckCache';
import {
  DialogSurface,
  IconButton,
  PrimaryButton,
  SegmentedControl,
  StatusLabel,
} from './ui';
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
  | { kind: 'error'; label: string };

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

type PersistenceStatus =
  | { kind: 'idle'; label: string }
  | { kind: 'loading'; label: string }
  | { kind: 'saving'; label: string }
  | { kind: 'saved'; label: string }
  | { kind: 'error'; label: string };

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

const getFileName = (filePath: string) => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

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

const formatPageSizeLabel = (pageSize: { width: number; height: number }) =>
  pageSize.width > 0 && pageSize.height > 0
    ? `${Math.round(pageSize.width)} x ${Math.round(pageSize.height)} px`
    : 'pending';

const createIdlePersistenceStatus = (): PersistenceStatus => ({
  kind: 'idle',
  label: 'No saved workspace',
});

type PdfPreviewProps = {
  filePath: string | null;
  title?: string;
  materials?: AgendaTalkMaterialSummary[];
  selectedMaterialId?: string | null;
  downloadStatus?: DeckCacheDownloadStatus | null;
  conferenceId?: string | null;
  talkId?: string | null;
  workspaceDeckId?: string | null;
  onBack?: () => void;
  onSelectMaterial?: (deckId: string) => void;
  onCancelDownload?: () => void;
  onRetryDownload?: () => void;
  onExportNotes?: () => void;
};

export function PdfPreview({
  filePath,
  title,
  materials = [],
  selectedMaterialId = null,
  downloadStatus = null,
  conferenceId = null,
  talkId = null,
  workspaceDeckId = null,
  onBack,
  onSelectMaterial,
  onCancelDownload,
  onRetryDownload,
  onExportNotes,
}: PdfPreviewProps) {
  const [state, setState] = React.useState<PdfPreviewState>({ kind: 'idle' });
  const [mouseMode, setMouseMode] = React.useState<MouseMode>('draw');
  const [manualTool, setManualTool] = React.useState<ManualTool>('pen');
  const [pointerDiagnostics, setPointerDiagnostics] =
    React.useState<PointerDiagnostics>(createIdlePointerDiagnostics());
  const pageCanvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const stageScrollRef = React.useRef<HTMLDivElement | null>(null);
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
  const [persistenceStatus, setPersistenceStatus] =
    React.useState<PersistenceStatus>(createIdlePersistenceStatus());
  const pointerDiagnosticsFrameRef = React.useRef<number | null>(null);
  const pendingPointerDiagnosticsRef = React.useRef<PointerDiagnostics | null>(
    null,
  );
  const persistenceSaveTimerRef = React.useRef<number | null>(null);
  const persistenceHydratedRef = React.useRef(false);
  const pendingWorkspaceRestoreRef = React.useRef<PdfWorkspaceSnapshot | null>(
    null,
  );
  const currentSlideNumberRef = React.useRef(1);
  const pageFigureRefs = React.useRef<Array<HTMLElement | null>>([]);
  const [zoomLevel, setZoomLevel] = React.useState(1);
  const [previewViewportWidth, setPreviewViewportWidth] = React.useState(0);
  const [currentSlideNumber, setCurrentSlideNumber] = React.useState(1);
  const [jumpToSlideValue, setJumpToSlideValue] = React.useState('1');
  const [isNavigatorCollapsed, setIsNavigatorCollapsed] = React.useState(false);

  React.useEffect(() => {
    const viewportElement = stageScrollRef.current;
    if (!viewportElement) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.max(
        0,
        Math.floor(viewportElement.getBoundingClientRect().width - 36),
      );
      setPreviewViewportWidth((currentWidth) =>
        currentWidth === nextWidth ? currentWidth : nextWidth,
      );
    };

    updateWidth();
    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(viewportElement);

    return () => {
      observer.disconnect();
    };
  }, []);

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
    state.kind === 'loading' || state.kind === 'ready' ? state.pageCount : 0;

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

    setTextNotesByPage((currentPages) => {
      const nextPages = currentPages.length
        ? currentPages.map((pageNotes, pageIndex) => {
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
      return nextPages;
    });

    closeTextNoteDraft();
  }, [
    closeTextNoteDraft,
    conferenceId,
    currentPageCount,
    filePath,
    state.kind,
    talkId,
    textNoteDraft,
    recordWorkspaceSnapshot,
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

  const handleJumpToSlide = React.useCallback(() => {
    const parsed = Number(jumpToSlideValue);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > currentPageCount) {
      return;
    }

    const pageNumber = parsed;
    const pageIndex = pageNumber - 1;
    const target = pageFigureRefs.current[pageIndex];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    currentSlideNumberRef.current = pageNumber;
    setCurrentSlideNumber(pageNumber);
  }, [currentPageCount, jumpToSlideValue]);

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

    setPersistenceStatus({
      kind: 'saving',
      label: 'Saving workspace...',
    });

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
        scrollLeft: stageScrollRef.current?.scrollLeft ?? 0,
        scrollTop: stageScrollRef.current?.scrollTop ?? 0,
        zoom: zoomLevel,
        ...(workspaceDeckId && conferenceId ? { conferenceId } : {}),
        ...(workspaceDeckId && talkId ? { talkId } : {}),
        ...(workspaceDeckId ? { deckId: workspaceDeckId } : {}),
      };

      const saveWorkspace = workspaceDeckId
        ? window.indicoInk.saveDeckWorkspaceState(snapshot)
        : window.indicoInk.savePdfWorkspaceState(snapshot);

      void saveWorkspace
        .then((result) => {
          setPersistenceStatus({
            kind: 'saved',
            label: `Saved ${getFileName(result.sourceUrl)}`,
          });
        })
        .catch((error) => {
          setPersistenceStatus({
            kind: 'error',
            label:
              error instanceof Error
                ? error.message
                : 'Failed to save workspace.',
          });
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

  const handleStageScroll = React.useCallback(() => {
    if (
      !filePath ||
      state.kind !== 'ready' ||
      !persistenceHydratedRef.current
    ) {
      return;
    }

    schedulePersistenceSave();
  }, [filePath, schedulePersistenceSave, state.kind]);

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
        currentSlideNumberRef.current = pageIndex + 1;
        setCurrentSlideNumber(pageIndex + 1);
        setJumpToSlideValue(String(pageIndex + 1));
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

          if (interactionMode === 'pan' && stageScrollRef.current) {
            activeInkActionRef.current = {
              kind: 'pan',
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startClientY: event.clientY,
              startScrollLeft: stageScrollRef.current.scrollLeft,
              startScrollTop: stageScrollRef.current.scrollTop,
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
            stageScrollRef.current
          ) {
            const deltaX =
              event.clientX - activeInkActionRef.current.startClientX;
            const deltaY =
              event.clientY - activeInkActionRef.current.startClientY;

            stageScrollRef.current.scrollLeft =
              activeInkActionRef.current.startScrollLeft - deltaX;
            stageScrollRef.current.scrollTop =
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
          if (
            activeInkActionRef.current?.pointerId === event.pointerId &&
            (activeInkActionRef.current.kind === 'pan' ||
              activeInkActionRef.current.kind === 'text' ||
              activeInkActionRef.current.pageIndex === pageIndex)
          ) {
            activeInkActionRef.current = null;
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
    ],
  );

  React.useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

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
        persistenceHydratedRef.current = false;
        if (persistenceSaveTimerRef.current !== null) {
          window.clearTimeout(persistenceSaveTimerRef.current);
          persistenceSaveTimerRef.current = null;
        }
        setPersistenceStatus(createIdlePersistenceStatus());
        return;
      }

      setState({
        kind: 'loading',
        label: `Loading ${getFileName(filePath)} with PDF.js print intent`,
        pageCount: 0,
        pageSizes: [],
        pageStatuses: [],
      });
      pendingWorkspaceRestoreRef.current = null;
      persistenceHydratedRef.current = false;
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
        setState({
          kind: 'loading',
          label: `Rendering ${pageCount} pages from ${getFileName(filePath)}`,
          pageCount,
          pageSizes,
          pageStatuses,
        });
        await waitForNextFrame();

        setState({
          kind: 'ready',
          label: `Rendering ${pageCount} pages from ${getFileName(filePath)}`,
          pageCount,
          pageSizes,
          pageStatuses,
        });

        persistenceHydratedRef.current = false;
        setPersistenceStatus({
          kind: 'loading',
          label: `Loading saved workspace for ${getFileName(filePath)}`,
        });
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
          setState((currentState) =>
            currentState.kind === 'loading' || currentState.kind === 'ready'
              ? {
                  ...currentState,
                  pageSizes: [...pageSizes],
                  pageStatuses: [...pageStatuses],
                }
              : currentState,
          );
        }

        if (!cancelled) {
          setState({
            kind: 'ready',
            label: `Rendered ${pageCount} pages from ${getFileName(filePath)}`,
            pageCount,
            pageSizes,
            pageStatuses,
          });
        }

        await loadingTask.destroy();
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : 'PDF preview failed.';
          setState({
            kind: 'error',
            label: message,
          });
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

    const restore = pendingWorkspaceRestoreRef.current;
    if (!restore) {
      persistenceHydratedRef.current = true;
      setPersistenceStatus(createIdlePersistenceStatus());
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (stageScrollRef.current) {
        stageScrollRef.current.scrollLeft = restore.scrollLeft;
        stageScrollRef.current.scrollTop = restore.scrollTop;
      }

      currentSlideNumberRef.current = restore.currentSlideNumber;
      setCurrentSlideNumber(restore.currentSlideNumber);
      setJumpToSlideValue(String(restore.currentSlideNumber));
      setZoomLevel(restore.zoom || 1);
      pendingWorkspaceRestoreRef.current = null;
      persistenceHydratedRef.current = true;
      setPersistenceStatus({
        kind: 'saved',
        label: `Restored ${getFileName(filePath)}`,
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [filePath, state.kind]);

  const pointerToolLabel = pointerDiagnostics.renderedTool;
  const pointerModeLabel =
    manualTool === 'text'
      ? 'text'
      : pointerDiagnostics.resolvedTool === 'mouse'
        ? mouseMode === 'draw'
          ? manualTool
          : 'pan'
        : pointerDiagnostics.interactionMode;
  const pointerCursorLabel =
    manualTool === 'text'
      ? 'text'
      : pointerDiagnostics.resolvedTool === 'mouse'
        ? getPointerCursorForInteraction(
            'mouse',
            mouseMode === 'draw'
              ? manualTool === 'eraser'
                ? 'erase'
                : 'draw'
              : 'pan',
          )
        : pointerDiagnostics.cursor;
  const pressureWidthLabel = `${getStrokeWidth(pointerDiagnostics.pressure).toFixed(1)} px`;
  const pdfWorkerSrc = getPdfWorkerSrc();
  const rendererLocation = window.location.href;
  const rendererBaseUri = document.baseURI;
  const rendererPath = window.location.pathname;
  const renderedPageCount =
    state.kind === 'loading' || state.kind === 'ready'
      ? state.pageStatuses.filter((pageStatus) => pageStatus === 'ready').length
      : 0;
  const pageDiagnostics =
    state.kind === 'loading' || state.kind === 'ready'
      ? {
          pageCount: state.pageCount,
          renderedPageCount,
          firstPageStatus: state.pageStatuses[0] ?? 'pending',
          lastPageStatus:
            state.pageStatuses[state.pageStatuses.length - 1] ?? 'pending',
          firstPageSize: state.pageSizes[0] ?? { width: 0, height: 0 },
          lastPageSize: state.pageSizes[state.pageSizes.length - 1] ?? {
            width: 0,
            height: 0,
          },
        }
      : null;
  const pdfMaterials = materials.filter(
    (material) => material.mimeType === 'application/pdf',
  );
  const downloadLabel =
    downloadStatus?.message ??
    (downloadStatus?.kind === 'downloading'
      ? `Downloading ${Math.round(
          downloadStatus.totalBytes
            ? (downloadStatus.bytesDownloaded / downloadStatus.totalBytes) * 100
            : 0,
        )}%`
      : downloadStatus?.kind === 'ready'
        ? 'Download complete'
        : null);

  return (
    <section className="pdf-preview" aria-label="PDF preview">
      <div className="pdf-preview-topbar">
        <div className="surface-panel-header">
          <h3>{title ?? 'Selected PDF'}</h3>
          <p>Continuous vertical roll rendered with PDF.js print intent.</p>
        </div>
        <div className="pdf-preview-topbar-actions">
          {onBack ? (
            <IconButton label="Back to agenda" icon="back" onClick={onBack} />
          ) : null}
          {pdfMaterials.length > 1 && onSelectMaterial ? (
            <SegmentedControl
              options={pdfMaterials.map((material) => ({
                label: material.title,
                value: material.id,
              }))}
              value={selectedMaterialId ?? pdfMaterials[0]?.id ?? ''}
              onChange={onSelectMaterial}
            />
          ) : null}
          {onExportNotes ? (
            <PrimaryButton icon="export" onClick={onExportNotes}>
              Export notes
            </PrimaryButton>
          ) : null}
        </div>
      </div>

      <div className="pdf-preview-status-row">
        {downloadLabel ? (
          <StatusLabel
            label={downloadLabel}
            tone={
              downloadStatus?.kind === 'error'
                ? 'error'
                : downloadStatus?.kind === 'ready'
                  ? 'success'
                  : downloadStatus?.kind === 'canceled'
                    ? 'warning'
                    : 'neutral'
            }
            icon={
              downloadStatus?.kind === 'error'
                ? 'info'
                : downloadStatus?.kind === 'ready'
                  ? 'check'
                  : 'info'
            }
          />
        ) : null}
        {state.kind === 'idle' ? (
          <StatusLabel
            label="Choose a PDF to render a preview."
            tone="neutral"
            icon="info"
          />
        ) : (
          <StatusLabel
            label={state.label}
            tone={state.kind === 'error' ? 'error' : 'neutral'}
            icon={state.kind === 'error' ? 'info' : 'check'}
          />
        )}
        <StatusLabel
          label={`${currentSlideNumber} / ${currentPageCount || 0} slides`}
          tone="neutral"
          icon="agenda"
        />
      </div>

      <div className="pdf-preview-toolbar" aria-label="Annotation toolbar">
        <div className="surface-panel-header">
          <h4>Annotation toolbar</h4>
          <p>
            Draw, place text, erase, undo, redo, zoom, and jump without leaving
            the roll.
          </p>
        </div>
        <div className="pdf-preview-toolbar-row">
          <div className="pdf-preview-toolbar-actions">
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
            <StatusLabel
              label={`${Math.round(zoomLevel * 100)}%`}
              icon="info"
            />
            <IconButton label="Zoom in" icon="plus" onClick={handleZoomIn} />
          </div>
        </div>
        <div className="pdf-preview-toolbar-row">
          <label className="field pdf-preview-jump-field">
            <span>Jump to slide</span>
            <input
              value={jumpToSlideValue}
              onChange={(event) => setJumpToSlideValue(event.target.value)}
              type="number"
              min={1}
              max={currentPageCount || 1}
            />
          </label>
          <PrimaryButton onClick={handleJumpToSlide}>Go</PrimaryButton>
          {onCancelDownload &&
          downloadStatus &&
          downloadStatus.kind === 'downloading' ? (
            <PrimaryButton onClick={onCancelDownload}>Cancel</PrimaryButton>
          ) : null}
          {onRetryDownload && downloadStatus?.kind === 'error' ? (
            <PrimaryButton onClick={onRetryDownload}>Retry</PrimaryButton>
          ) : null}
        </div>
        <div className="pdf-preview-toolbar-status">
          <StatusLabel
            label={persistenceStatus.label}
            tone={
              persistenceStatus.kind === 'error'
                ? 'error'
                : persistenceStatus.kind === 'saved'
                  ? 'success'
                  : 'neutral'
            }
            icon={persistenceStatus.kind === 'saved' ? 'check' : 'info'}
          />
        </div>
      </div>

      <div className="pdf-preview-diagnostics" aria-label="Pointer diagnostics">
        <div className="pdf-preview-diagnostics-row">
          <StatusLabel
            label={`Rendered tool: ${pointerToolLabel}`}
            tone={pointerToolLabel === 'eraser' ? 'warning' : 'neutral'}
            icon={pointerToolLabel === 'eraser' ? 'annotated' : 'info'}
          />
          <StatusLabel label={`Mode: ${pointerModeLabel}`} icon="info" />
          <StatusLabel label={`Cursor: ${pointerCursorLabel}`} icon="info" />
          <StatusLabel
            label={`SVG class: ${pointerDiagnostics.overlayClass}`}
            icon="info"
          />
        </div>
        <div className="pdf-preview-diagnostics-grid">
          <div>
            <span>Event</span>
            <strong>{pointerDiagnostics.eventKind}</strong>
          </div>
          <div>
            <span>Pointer id</span>
            <strong>{pointerDiagnostics.pointerId ?? 'none'}</strong>
          </div>
          <div>
            <span>Pointer type</span>
            <strong>{pointerDiagnostics.pointerType}</strong>
          </div>
          <div>
            <span>Button</span>
            <strong>{pointerDiagnostics.button}</strong>
          </div>
          <div>
            <span>Buttons</span>
            <strong>{pointerDiagnostics.buttons}</strong>
          </div>
          <div>
            <span>Pressure</span>
            <strong>{pointerDiagnostics.pressure.toFixed(3)}</strong>
          </div>
          <div>
            <span>Width</span>
            <strong>{pressureWidthLabel}</strong>
          </div>
          <div>
            <span>Primary</span>
            <strong>{pointerDiagnostics.isPrimary ? 'yes' : 'no'}</strong>
          </div>
          <div>
            <span>Resolved</span>
            <strong>{pointerDiagnostics.resolvedTool}</strong>
          </div>
          <div>
            <span>Latched</span>
            <strong>{pointerDiagnostics.latchedTool ?? 'none'}</strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>{pointerModeLabel}</strong>
          </div>
        </div>
        <div className="pdf-preview-pressure-meter" aria-hidden="true">
          <span className="pdf-preview-pressure-meter-label">
            Pressure preview
          </span>
          <div className="pdf-preview-pressure-track">
            <div
              className="pdf-preview-pressure-fill"
              style={{
                width: `${Math.max(0, Math.min(pointerDiagnostics.pressure, 1)) * 100}%`,
              }}
            />
          </div>
        </div>
        <div className="pdf-preview-render-diagnostics">
          <span className="pdf-preview-render-diagnostics-label">
            PDF render diagnostics
          </span>
          <div className="pdf-preview-render-diagnostics-grid">
            <div>
              <span>Worker</span>
              <strong>{getFileName(pdfWorkerSrc)}</strong>
            </div>
            <div>
              <span>Renderer</span>
              <strong>{rendererLocation}</strong>
            </div>
            <div>
              <span>Base URI</span>
              <strong>{rendererBaseUri}</strong>
            </div>
            <div>
              <span>Path</span>
              <strong>{rendererPath}</strong>
            </div>
            <div>
              <span>File</span>
              <strong>{filePath ? getFileName(filePath) : 'none'}</strong>
            </div>
            <div>
              <span>Page count</span>
              <strong>{pageDiagnostics?.pageCount ?? 0}</strong>
            </div>
            <div>
              <span>Rendered</span>
              <strong>
                {pageDiagnostics
                  ? `${pageDiagnostics.renderedPageCount}/${pageDiagnostics.pageCount}`
                  : '0/0'}
              </strong>
            </div>
            <div>
              <span>First page</span>
              <strong>
                {pageDiagnostics
                  ? `${pageDiagnostics.firstPageStatus} / ${formatPageSizeLabel(pageDiagnostics.firstPageSize)}`
                  : 'idle'}
              </strong>
            </div>
            <div>
              <span>Last page</span>
              <strong>
                {pageDiagnostics
                  ? `${pageDiagnostics.lastPageStatus} / ${formatPageSizeLabel(pageDiagnostics.lastPageSize)}`
                  : 'idle'}
              </strong>
            </div>
            <div>
              <span>Render label</span>
              <strong>{state.kind === 'idle' ? 'idle' : state.label}</strong>
            </div>
          </div>
        </div>
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
          <StatusLabel
            label={`${currentSlideNumber} / ${currentPageCount || 0}`}
            tone="neutral"
            icon="agenda"
          />
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
                  setJumpToSlideValue(String(index + 1));
                  currentSlideNumberRef.current = index + 1;
                  setCurrentSlideNumber(index + 1);
                  const target = pageFigureRefs.current[index];
                  target?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  });
                }}
              >
                <span>Slide {index + 1}</span>
                {annotated ? (
                  <StatusLabel
                    label="Annotated"
                    tone="warning"
                    icon="annotated"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </details>

      <div
        ref={stageScrollRef}
        className="pdf-preview-stage"
        onScroll={handleStageScroll}
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
        {state.kind === 'ready' || state.kind === 'loading' ? (
          <div className="pdf-preview-pages">
            {Array.from({ length: currentPageCount }, (_, index) => {
              const pageSize = state.pageSizes[index] ?? {
                width: 1,
                height: 1,
              };
              const pageStatus =
                (state.kind === 'loading' || state.kind === 'ready'
                  ? state.pageStatuses[index]
                  : undefined) ?? 'pending';
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
                >
                  <figcaption className="pdf-preview-page-caption">
                    <span>Page {index + 1}</span>
                    <StatusLabel
                      label={pageStatus === 'ready' ? 'Ready' : 'Loading'}
                      tone={pageStatus === 'ready' ? 'success' : 'neutral'}
                      icon={pageStatus === 'ready' ? 'check' : 'info'}
                    />
                  </figcaption>
                  <div
                    className="pdf-preview-sheet"
                    data-rendered-tool={pointerDiagnostics.renderedTool}
                    draggable={false}
                    style={{ cursor: pointerDiagnostics.cursor }}
                    onPointerEnter={handlePagePointerEvent(
                      index,
                      'pointerenter',
                    )}
                    onPointerMove={handlePagePointerEvent(index, 'pointermove')}
                    onPointerDown={handlePagePointerEvent(index, 'pointerdown')}
                    onPointerUp={handlePagePointerEvent(index, 'pointerup')}
                    onPointerCancel={handlePagePointerEvent(
                      index,
                      'pointercancel',
                    )}
                    onPointerLeave={handlePagePointerEvent(
                      index,
                      'pointerleave',
                    )}
                  >
                    <canvas
                      ref={(element) => {
                        pageCanvasRefs.current[index] = element;
                      }}
                      className="pdf-preview-canvas"
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
