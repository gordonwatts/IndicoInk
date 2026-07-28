/// <reference lib="webworker" />

import { drawInkStroke } from './inkCanvas';
import type { InkStroke } from './strokeTools';

type InkRasterRequest = {
  id: number;
  pixelWidth: number;
  pixelHeight: number;
  displayWidth: number;
  displayHeight: number;
  pageSize: { width: number; height: number };
  strokes: InkStroke[];
};

self.onmessage = (event: MessageEvent<InkRasterRequest>) => {
  const request = event.data;
  const canvas = new OffscreenCanvas(request.pixelWidth, request.pixelHeight);
  const context = canvas.getContext('2d');
  if (!context) {
    self.postMessage({ id: request.id, error: '2D canvas is unavailable.' });
    return;
  }

  context.setTransform(
    request.pixelWidth / Math.max(1, request.pageSize.width),
    0,
    0,
    request.pixelHeight / Math.max(1, request.pageSize.height),
    0,
    0,
  );
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#111111';
  context.fillStyle = '#111111';
  for (const stroke of request.strokes) {
    drawInkStroke(context, stroke, request.pageSize);
  }

  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({ id: request.id, bitmap }, [bitmap]);
};

export {};
