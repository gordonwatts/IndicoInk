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
import { IconButton, SegmentedControl, StatusLabel } from './ui';

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
      kind: 'pan';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startScrollLeft: number;
      startScrollTop: number;
    }
  | null;

type MouseMode = 'draw' | 'pan';
type ManualTool = 'pen' | 'eraser';

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

const cloneStrokePages = (pages: Array<InkStroke[]>) =>
  pages.map((pageStrokes) =>
    pageStrokes.map((stroke) => ({
      ...stroke,
      points: [...stroke.points],
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
  const bounds = event.currentTarget.getBoundingClientRect();
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

const formatPageSizeLabel = (pageSize: { width: number; height: number }) =>
  pageSize.width > 0 && pageSize.height > 0
    ? `${Math.round(pageSize.width)} x ${Math.round(pageSize.height)} px`
    : 'pending';

const createIdlePersistenceStatus = (): PersistenceStatus => ({
  kind: 'idle',
  label: 'No saved workspace',
});

export function PdfPreview({ filePath }: { filePath: string | null }) {
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
  const [undoStack, setUndoStack] = React.useState<Array<Array<InkStroke[]>>>(
    [],
  );
  const [redoStack, setRedoStack] = React.useState<Array<Array<InkStroke[]>>>(
    [],
  );
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

      const interactionMode =
        toolState.renderedTool === 'mouse'
          ? mouseMode === 'draw'
            ? manualTool === 'eraser'
              ? 'erase'
              : 'draw'
            : 'pan'
          : toolState.renderedTool === 'pen'
            ? manualTool === 'eraser'
              ? 'erase'
              : 'draw'
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

  const recordStrokeSnapshot = React.useCallback(() => {
    setUndoStack((currentUndoStack) => [
      cloneStrokePages(strokesByPage),
      ...currentUndoStack,
    ]);
    setRedoStack([]);
  }, [strokesByPage]);

  const handleUndo = React.useCallback(() => {
    const previousPages = undoStack[0];
    if (!previousPages) {
      return;
    }

    const rest = undoStack.slice(1);
    setRedoStack((currentRedoStack) => [
      cloneStrokePages(strokesByPage),
      ...currentRedoStack,
    ]);
    setUndoStack(rest);
    setStrokesByPage(previousPages);
  }, [strokesByPage, undoStack]);

  const handleRedo = React.useCallback(() => {
    const nextPages = redoStack[0];
    if (!nextPages) {
      return;
    }

    const rest = redoStack.slice(1);
    setUndoStack((currentUndoStack) => [
      cloneStrokePages(strokesByPage),
      ...currentUndoStack,
    ]);
    setRedoStack(rest);
    setStrokesByPage(nextPages);
  }, [redoStack, strokesByPage]);

  const currentPageCount =
    state.kind === 'loading' || state.kind === 'ready' ? state.pageCount : 0;

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

      void window.indicoInk
        .savePdfWorkspaceState({
          sourceUrl: filePath,
          pageCount: currentPageCount,
          strokesByPage,
          currentSlideNumber: currentSlideNumberRef.current,
          scrollLeft: stageScrollRef.current?.scrollLeft ?? 0,
          scrollTop: stageScrollRef.current?.scrollTop ?? 0,
          zoom: 1,
        })
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
  }, [currentPageCount, filePath, state.kind, strokesByPage]);

  React.useEffect(() => {
    if (
      !filePath ||
      state.kind !== 'ready' ||
      !persistenceHydratedRef.current
    ) {
      return;
    }

    schedulePersistenceSave();
  }, [filePath, schedulePersistenceSave, state.kind, strokesByPage]);

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
          if (interactionMode === 'draw' && pagePoint) {
            event.preventDefault();
            recordStrokeSnapshot();
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
            recordStrokeSnapshot();
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

        if (eventKind === 'pointerup' || eventKind === 'pointercancel') {
          if (
            activeInkActionRef.current?.pointerId === event.pointerId &&
            (activeInkActionRef.current.kind === 'pan' ||
              activeInkActionRef.current.pageIndex === pageIndex)
          ) {
            activeInkActionRef.current = null;
          }

          if (pointerMarker?.pageIndex === pageIndex) {
            setPointerMarker(null);
          }
        }
      },
    [
      handlePointerEvent,
      pointerMarker,
      resolvePointerInteraction,
      state,
      recordStrokeSnapshot,
      updateStrokePage,
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
        setUndoStack([]);
        setRedoStack([]);
        setPointerMarker(null);
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
        setStrokesByPage(createEmptyStrokePages(pageCount));
        setUndoStack([]);
        setRedoStack([]);
        setPointerMarker(null);
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
        const savedWorkspace =
          await window.indicoInk.loadPdfWorkspaceState(filePath);
        if (cancelled) {
          return;
        }

        if (savedWorkspace) {
          setStrokesByPage(
            savedWorkspace.strokesByPage.length
              ? savedWorkspace.strokesByPage
              : createEmptyStrokePages(pageCount),
          );
          pendingWorkspaceRestoreRef.current = savedWorkspace;
        } else {
          setStrokesByPage(createEmptyStrokePages(pageCount));
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

          const viewport = page.getViewport({ scale: 1.4 });
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
  }, [filePath]);

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
    pointerDiagnostics.resolvedTool === 'mouse'
      ? mouseMode === 'draw'
        ? manualTool
        : 'pan'
      : pointerDiagnostics.interactionMode;
  const pointerCursorLabel =
    pointerDiagnostics.resolvedTool === 'mouse'
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

  return (
    <section className="pdf-preview" aria-label="PDF preview">
      <div className="surface-panel-header">
        <h3>Selected PDF</h3>
        <p>Continuous vertical roll rendered with PDF.js print intent.</p>
      </div>

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

      <div className="pdf-preview-toolbar" aria-label="Mouse drawing mode">
        <div className="surface-panel-header">
          <h4>Input mode</h4>
          <p>Mouse input can stay in draw mode or pan the document.</p>
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

      <div
        ref={stageScrollRef}
        className="pdf-preview-stage"
        onScroll={handleStageScroll}
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
              const marker =
                pointerMarker?.pageIndex === index ? pointerMarker : null;
              const strokeSegments = pageStrokes.flatMap((stroke) =>
                stroke.points.length === 1
                  ? [
                      <circle
                        key={`${stroke.id}-point`}
                        cx={stroke.points[0]!.x * (pageSize.width || 1)}
                        cy={stroke.points[0]!.y * (pageSize.height || 1)}
                        r={
                          stroke.points[0]!.pressure > 0
                            ? 2.5 + stroke.points[0]!.pressure * 2
                            : 3
                        }
                        fill="#111111"
                      />,
                    ]
                  : createStrokeSegmentList(stroke.points, pageSize).map(
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
                    ),
              );

              return (
                <figure key={index} className="pdf-preview-page">
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
                      {marker ? (
                        marker.tool === 'pen' ? (
                          <circle
                            key="pointer-marker"
                            cx={marker.point.x * (pageSize.width || 1)}
                            cy={marker.point.y * (pageSize.height || 1)}
                            r="5"
                            className="pdf-preview-pointer-marker pen"
                          />
                        ) : (
                          <rect
                            key="pointer-marker"
                            x={marker.point.x * (pageSize.width || 1) - 6}
                            y={marker.point.y * (pageSize.height || 1) - 6}
                            width="12"
                            height="12"
                            rx="3"
                            className="pdf-preview-pointer-marker eraser"
                          />
                        )
                      ) : null}
                    </svg>
                  </div>
                </figure>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
