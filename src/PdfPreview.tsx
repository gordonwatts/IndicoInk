import React from 'react';

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

const getFileName = (filePath: string) => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

const waitForNextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

const createPageSizes = (pageCount: number) =>
  Array.from({ length: pageCount }, () => ({ width: 0, height: 0 }));

export function PdfPreview({ filePath }: { filePath: string | null }) {
  const [state, setState] = React.useState<PdfPreviewState>({ kind: 'idle' });
  const pageCanvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);

  React.useEffect(() => {
    let cancelled = false;
    let loadingTask: { promise: Promise<any>; destroy: () => Promise<void> | void } | null =
      null;

    const renderPreview = async () => {
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

      <div className="pdf-preview-stage">
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
                  <div className="pdf-preview-sheet">
                    <canvas
                      ref={(element) => {
                        pageCanvasRefs.current[index] = element;
                      }}
                      className="pdf-preview-canvas"
                    />
                    <svg
                      aria-hidden="true"
                      className="pdf-preview-overlay"
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
