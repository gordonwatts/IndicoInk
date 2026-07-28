import React from 'react';

import {
  rebuildInkCanvas,
  sizeInkCanvas,
  type InkCanvasMetrics,
} from './inkCanvas';
import { rasterInkInWorker } from './inkRasterClient';
import type { InkStroke } from './strokeTools';

export type InkLayerCanvasRefs = {
  dry: React.MutableRefObject<Array<HTMLCanvasElement | null>>;
  wet: React.MutableRefObject<Array<HTMLCanvasElement | null>>;
  predicted: React.MutableRefObject<Array<HTMLCanvasElement | null>>;
  liveCommittedStrokeIds: React.MutableRefObject<Set<string>>;
};

type PdfInkLayerProps = {
  pageIndex: number;
  pageSize: { width: number; height: number };
  displayWidth: number;
  displayHeight: number;
  strokes: InkStroke[];
  canvasRefs: InkLayerCanvasRefs;
  overlayClass: string;
};

const PdfInkLayerComponent = ({
  pageIndex,
  pageSize,
  displayWidth,
  displayHeight,
  strokes,
  canvasRefs,
  overlayClass,
}: PdfInkLayerProps) => {
  const metrics = React.useMemo<InkCanvasMetrics>(
    () => ({ displayWidth, displayHeight, pageSize }),
    [displayHeight, displayWidth, pageSize.height, pageSize.width],
  );
  const previousStrokesRef = React.useRef<InkStroke[] | null>(null);

  React.useLayoutEffect(() => {
    const dryCanvas = canvasRefs.dry.current[pageIndex];
    const wetCanvas = canvasRefs.wet.current[pageIndex];
    const predictedCanvas = canvasRefs.predicted.current[pageIndex];
    if (!dryCanvas || !wetCanvas || !predictedCanvas) {
      return;
    }

    sizeInkCanvas(wetCanvas, metrics);
    sizeInkCanvas(predictedCanvas, metrics);
    const previousStrokes = previousStrokesRef.current;
    previousStrokesRef.current = strokes;
    const appendedStroke = strokes.at(-1);
    const wasPaintedLive =
      appendedStroke !== undefined &&
      canvasRefs.liveCommittedStrokeIds.current.delete(appendedStroke.id);
    const isSingleAppend =
      previousStrokes !== null &&
      strokes.length === previousStrokes.length + 1 &&
      previousStrokes.every((stroke, index) => stroke === strokes[index]);
    if (wasPaintedLive && isSingleAppend) {
      return;
    }

    dryCanvas.dataset.rasterStatus = 'pending';
    const workerRaster = rasterInkInWorker(strokes, metrics);
    if (!workerRaster) {
      rebuildInkCanvas(dryCanvas, strokes, metrics);
      dryCanvas.dataset.rasterStatus = 'ready';
      return;
    }

    let cancelled = false;
    void workerRaster
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        sizeInkCanvas(dryCanvas, metrics);
        const context = dryCanvas.getContext('2d');
        if (!context) {
          bitmap.close();
          return;
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, dryCanvas.width, dryCanvas.height);
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        dryCanvas.dataset.rasterStatus = 'ready';
      })
      .catch(() => {
        if (!cancelled) {
          rebuildInkCanvas(dryCanvas, strokes, metrics);
          dryCanvas.dataset.rasterStatus = 'ready';
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canvasRefs, metrics, pageIndex, strokes]);

  return (
    <div
      aria-hidden="true"
      className={`pdf-preview-ink-layers ${overlayClass}`}
    >
      <canvas
        ref={(element) => {
          canvasRefs.dry.current[pageIndex] = element;
        }}
        className="pdf-preview-ink-canvas dry"
        data-stroke-count={strokes.length}
        data-raster-status="pending"
      />
      <canvas
        ref={(element) => {
          canvasRefs.wet.current[pageIndex] = element;
        }}
        className="pdf-preview-ink-canvas wet"
      />
      <canvas
        ref={(element) => {
          canvasRefs.predicted.current[pageIndex] = element;
        }}
        className="pdf-preview-ink-canvas predicted"
      />
    </div>
  );
};

export const PdfInkLayer = React.memo(PdfInkLayerComponent);
