import React from 'react';

import {
  createPointerToolState,
  getPointerCursor,
  getPointerOverlayClass,
  type PointerEventKind,
  type PointerSample,
  type PointerTool,
} from './pointerTools';
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

const getFileName = (filePath: string) => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

const waitForNextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

const createPageSizes = (pageCount: number) =>
  Array.from({ length: pageCount }, () => ({ width: 0, height: 0 }));

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

export function PdfPreview({ filePath }: { filePath: string | null }) {
  const [state, setState] = React.useState<PdfPreviewState>({ kind: 'idle' });
  const [pointerDiagnostics, setPointerDiagnostics] = React.useState<PointerDiagnostics>(
    createIdlePointerDiagnostics(),
  );
  const pageCanvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const latchedToolRef = React.useRef<PointerTool | null>(null);

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

      <div
        className="pdf-preview-stage"
        onPointerEnter={handlePointerEvent('pointerenter')}
        onPointerMove={handlePointerEvent('pointermove')}
        onPointerDown={handlePointerEvent('pointerdown')}
        onPointerUp={handlePointerEvent('pointerup')}
        onPointerCancel={handlePointerEvent('pointercancel')}
        onPointerLeave={handlePointerEvent('pointerleave')}
      >
        {state.kind === 'ready' || state.kind === 'loading' ? (
          <div className="pdf-preview-pages">
            {Array.from({ length: state.pageCount }, (_, index) => {
              const pageSize = state.pageSizes[index] ?? {
                width: 1,
                height: 1,
              };

              return (
                <figure key={index} className="pdf-preview-page">
                  <figcaption className="pdf-preview-page-caption">
                    Page {index + 1}
                  </figcaption>
                  <div
                    className="pdf-preview-sheet"
                    data-rendered-tool={pointerDiagnostics.renderedTool}
                    style={{ cursor: pointerDiagnostics.cursor }}
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
                    />
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
