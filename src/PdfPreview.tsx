import React from 'react';

import {
  createPointerToolState,
  getPointerCursor,
  getPointerOverlayClass,
  type PointerEventKind,
  type PointerSample,
  type PointerTool,
} from './pointerTools';
import { toNormalizedPagePoint, type NormalizedPagePoint, type PageSize } from './inkGeometry';
import {
  createStrokeSegmentList,
  strokeHitsPoint,
  type InkStroke,
} from './strokeTools';
import { StatusLabel } from './ui';

type PdfPreviewState =
  | { kind: 'idle' }
  | {
      kind: 'loading';
      label: string;
      pageCount: number;
      pageSizes: Array<{ width: number; height: number }>;
    }
  | {
      kind: 'ready';
      label: string;
      pageCount: number;
      pageSizes: Array<{ width: number; height: number }>;
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
  cursor: string;
  overlayClass: string;
};

type PointerMarker = {
  pageIndex: number;
  point: NormalizedPagePoint;
  tool: PointerTool;
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
  | null;

const getFileName = (filePath: string) => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

const waitForNextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

const createPageSizes = (pageCount: number) =>
  Array.from({ length: pageCount }, () => ({ width: 0, height: 0 }));

const createEmptyStrokePages = (pageCount: number) =>
  Array.from({ length: pageCount }, () => [] as InkStroke[]);

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
  cursor: getPointerCursor('unknown'),
  overlayClass: getPointerOverlayClass('unknown'),
});

const toPointerSample = (event: React.PointerEvent<HTMLDivElement>): PointerSample => ({
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

export function PdfPreview({ filePath }: { filePath: string | null }) {
  const [state, setState] = React.useState<PdfPreviewState>({ kind: 'idle' });
  const [pointerDiagnostics, setPointerDiagnostics] = React.useState<PointerDiagnostics>(
    createIdlePointerDiagnostics(),
  );
  const pageCanvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const latchedToolRef = React.useRef<PointerTool | null>(null);
  const activeInkActionRef = React.useRef<ActiveInkAction>(null);
  const [strokesByPage, setStrokesByPage] = React.useState<Array<InkStroke[]>>([]);
  const [pointerMarker, setPointerMarker] = React.useState<PointerMarker | null>(null);

  const updatePointerDiagnostics = React.useCallback(
    (eventKind: PointerEventKind, event: React.PointerEvent<HTMLDivElement>) => {
      const sample = toPointerSample(event);
      const toolState = createPointerToolState(sample, eventKind, latchedToolRef.current);

      latchedToolRef.current = toolState.latchedTool;
      setPointerDiagnostics({
        eventKind,
        pointerId: event.pointerId,
        pointerType: sample.pointerType,
        button: sample.button,
        buttons: sample.buttons,
        pressure: sample.pressure,
        isPrimary: sample.isPrimary,
        resolvedTool: toolState.resolvedTool,
        latchedTool: toolState.latchedTool,
        renderedTool: toolState.renderedTool,
        cursor: getPointerCursor(toolState.renderedTool),
        overlayClass: getPointerOverlayClass(toolState.renderedTool),
      });
    },
    [],
  );

  const handlePointerEvent = React.useCallback(
    (eventKind: PointerEventKind) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (eventKind === 'pointerdown') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      updatePointerDiagnostics(eventKind, event);

      if (eventKind === 'pointerup' || eventKind === 'pointercancel') {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }
    },
    [updatePointerDiagnostics],
  );

  const updateStrokePage = React.useCallback(
    (pageIndex: number, updater: (currentStrokes: InkStroke[]) => InkStroke[]) => {
      setStrokesByPage((currentPages) =>
        currentPages.map((pageStrokes, currentIndex) =>
          currentIndex === pageIndex ? updater(pageStrokes) : pageStrokes,
        ),
      );
    },
    [],
  );

  const handlePagePointerEvent = React.useCallback(
    (pageIndex: number, eventKind: PointerEventKind) =>
      (event: React.PointerEvent<HTMLDivElement>) => {
        const pageSize = state.kind === 'loading' || state.kind === 'ready'
          ? state.pageSizes[pageIndex]
          : undefined;

        if (!pageSize || pageSize.width <= 0 || pageSize.height <= 0) {
          handlePointerEvent(eventKind)(event);
          return;
        }

        handlePointerEvent(eventKind)(event);

        const sample = toPointerSample(event);
        const toolState = createPointerToolState(sample, eventKind, latchedToolRef.current);
        const pagePoint = getPagePoint(event, pageSize);
        const shouldShowMarker =
          toolState.renderedTool === 'pen' || toolState.renderedTool === 'eraser';

        if (shouldShowMarker) {
          setPointerMarker({
            pageIndex,
            point: pagePoint,
            tool: toolState.renderedTool,
          });
        } else {
          setPointerMarker(null);
        }

        if (eventKind === 'pointerdown') {
          if (toolState.renderedTool === 'mouse' || toolState.renderedTool === 'pen') {
            const strokeId = createStrokeId();
            activeInkActionRef.current = {
              kind: 'draw',
              pointerId: event.pointerId,
              pageIndex,
              strokeId,
            };
            setStrokesByPage((currentPages) => {
              const nextPages = currentPages.length ? [...currentPages] : createEmptyStrokePages(state.kind === 'loading' || state.kind === 'ready' ? state.pageCount : 0);
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

          if (toolState.renderedTool === 'eraser') {
            activeInkActionRef.current = {
              kind: 'erase',
              pointerId: event.pointerId,
              pageIndex,
            };
            setStrokesByPage((currentPages) => {
              const nextPages = currentPages.length ? [...currentPages] : createEmptyStrokePages(state.kind === 'loading' || state.kind === 'ready' ? state.pageCount : 0);
              nextPages[pageIndex] = (nextPages[pageIndex] ?? []).filter(
                (stroke) => !strokeHitsPoint(stroke, pagePoint, pageSize),
              );
              return nextPages;
            });
          }
        }

        if (
          eventKind === 'pointermove' &&
          activeInkActionRef.current &&
          activeInkActionRef.current.pointerId === event.pointerId
        ) {
          if (
            activeInkActionRef.current.kind === 'draw' &&
            activeInkActionRef.current.pageIndex === pageIndex
          ) {
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
            activeInkActionRef.current.pageIndex === pageIndex
          ) {
            updateStrokePage(pageIndex, (currentStrokes) =>
              currentStrokes.filter((stroke) => !strokeHitsPoint(stroke, pagePoint, pageSize)),
            );
          }
        }

        if (eventKind === 'pointerup' || eventKind === 'pointercancel') {
          if (
            activeInkActionRef.current?.pointerId === event.pointerId &&
            activeInkActionRef.current.pageIndex === pageIndex
          ) {
            activeInkActionRef.current = null;
          }

          if (pointerMarker?.pageIndex === pageIndex) {
            setPointerMarker(null);
          }
        }
      },
    [handlePointerEvent, pointerMarker, state, updateStrokePage],
  );

  React.useEffect(() => {
    let cancelled = false;
    let loadingTask: { promise: Promise<any>; destroy: () => Promise<void> | void } | null =
      null;

    const renderPreview = async () => {
      latchedToolRef.current = null;
      setPointerDiagnostics(createIdlePointerDiagnostics());

      if (!filePath) {
        pageCanvasRefs.current = [];
        setState({ kind: 'idle' });
        setStrokesByPage([]);
        setPointerMarker(null);
        return;
      }

      setState({
        kind: 'loading',
        label: `Loading ${getFileName(filePath)} with PDF.js print intent`,
        pageCount: 0,
        pageSizes: [],
      });

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
        setPointerMarker(null);
        const pageSizes = createPageSizes(pageCount);
        setState({
          kind: 'loading',
          label: `Rendering ${pageCount} pages from ${getFileName(filePath)}`,
          pageCount,
          pageSizes,
        });
        await waitForNextFrame();

        setState({
          kind: 'ready',
          label: `Rendering ${pageCount} pages from ${getFileName(filePath)}`,
          pageCount,
          pageSizes,
        });

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
            throw new Error(`Canvas rendering is unavailable for page ${pageNumber}.`);
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
            canvasContext: context,
            viewport,
          }).promise;

          pageSizes[pageNumber - 1] = { width, height };
          setState((currentState) =>
            currentState.kind === 'loading' || currentState.kind === 'ready'
              ? {
                  ...currentState,
                  pageSizes: [...pageSizes],
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
      void loadingTask?.destroy?.();
    };
  }, [filePath]);

  const pointerToolLabel = pointerDiagnostics.renderedTool;

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

      <div className="pdf-preview-diagnostics" aria-label="Pointer diagnostics">
        <div className="pdf-preview-diagnostics-row">
          <StatusLabel
            label={`Rendered tool: ${pointerToolLabel}`}
            tone={pointerToolLabel === 'eraser' ? 'warning' : 'neutral'}
            icon={pointerToolLabel === 'eraser' ? 'annotated' : 'info'}
          />
          <StatusLabel label={`Cursor: ${pointerDiagnostics.cursor}`} icon="info" />
          <StatusLabel label={`SVG class: ${pointerDiagnostics.overlayClass}`} icon="info" />
        </div>
        <div className="pdf-preview-diagnostics-grid">
          <div>
            <span>Event</span>
            <strong>{pointerDiagnostics.eventKind}</strong>
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
        </div>
      </div>

      <div className="pdf-preview-stage">
        {state.kind === 'ready' || state.kind === 'loading' ? (
          <div className="pdf-preview-pages">
            {Array.from({ length: state.pageCount }, (_, index) => {
              const pageSize = state.pageSizes[index] ?? {
                width: 1,
                height: 1,
              };
              const pageStrokes = strokesByPage[index] ?? [];
              const marker =
                pointerMarker?.pageIndex === index ? pointerMarker : null;
              const strokeSegments = pageStrokes.flatMap((stroke) =>
                createStrokeSegmentList(stroke.points, pageSize).map((segment, segmentIndex) => (
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
                )),
              );

              return (
                <figure key={index} className="pdf-preview-page">
                  <figcaption className="pdf-preview-page-caption">
                    Page {index + 1}
                  </figcaption>
                  <div
                    className="pdf-preview-sheet"
                    data-rendered-tool={pointerDiagnostics.renderedTool}
                    style={{ cursor: pointerDiagnostics.cursor }}
                    onPointerEnter={handlePagePointerEvent(index, 'pointerenter')}
                    onPointerMove={handlePagePointerEvent(index, 'pointermove')}
                    onPointerDown={handlePagePointerEvent(index, 'pointerdown')}
                    onPointerUp={handlePagePointerEvent(index, 'pointerup')}
                    onPointerCancel={handlePagePointerEvent(index, 'pointercancel')}
                    onPointerLeave={handlePagePointerEvent(index, 'pointerleave')}
                  >
                    <canvas
                      ref={(element) => {
                        pageCanvasRefs.current[index] = element;
                      }}
                      className="pdf-preview-canvas"
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
                            r="8"
                            className="pdf-preview-pointer-marker pen"
                          />
                        ) : (
                          <rect
                            key="pointer-marker"
                            x={marker.point.x * (pageSize.width || 1) - 8}
                            y={marker.point.y * (pageSize.height || 1) - 8}
                            width="16"
                            height="16"
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
