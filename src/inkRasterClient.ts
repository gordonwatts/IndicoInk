import type { InkCanvasMetrics } from './inkCanvas';
import type { InkStroke } from './strokeTools';
import InkRasterWorker from './inkRaster.worker?worker';

type PendingRequest = {
  resolve: (bitmap: ImageBitmap) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingRequest>();

const getWorker = () => {
  if (
    worker ||
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined'
  ) {
    return worker;
  }

  worker = new InkRasterWorker();
  worker.addEventListener(
    'message',
    (
      event: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>,
    ) => {
      const pending = pendingRequests.get(event.data.id);
      if (!pending) {
        event.data.bitmap?.close();
        return;
      }
      pendingRequests.delete(event.data.id);
      if (event.data.bitmap) {
        pending.resolve(event.data.bitmap);
      } else {
        pending.reject(new Error(event.data.error ?? 'Ink raster failed.'));
      }
    },
  );
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Ink raster worker failed.');
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
};

export const rasterInkInWorker = (
  strokes: InkStroke[],
  metrics: InkCanvasMetrics,
) => {
  const rasterWorker = getWorker();
  if (!rasterWorker) {
    return null;
  }

  const dpr = Math.max(1, metrics.devicePixelRatio ?? devicePixelRatio ?? 1);
  const id = nextRequestId++;
  const promise = new Promise<ImageBitmap>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
  });
  rasterWorker.postMessage({
    id,
    pixelWidth: Math.max(1, Math.round(metrics.displayWidth * dpr)),
    pixelHeight: Math.max(1, Math.round(metrics.displayHeight * dpr)),
    displayWidth: metrics.displayWidth,
    displayHeight: metrics.displayHeight,
    pageSize: metrics.pageSize,
    strokes,
  });
  return promise;
};
