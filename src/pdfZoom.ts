export type PdfZoomPoint = {
  x: number;
  y: number;
};

export type PdfZoomFocalAnchor = {
  pageIndex: number;
  pageOffsetXRatio: number;
  pageOffsetYRatio: number;
  midpoint: PdfZoomPoint;
  scrollLeft: number;
  scrollTop: number;
};

export const MIN_PDF_ZOOM = 1;
export const MAX_PDF_ZOOM = 2.5;
export const PDF_ZOOM_STEP = 0.15;

export const clampPdfZoom = (value: number) =>
  Math.max(MIN_PDF_ZOOM, Math.min(MAX_PDF_ZOOM, value));

export const getPinchDistance = (first: PdfZoomPoint, second: PdfZoomPoint) =>
  Math.hypot(second.x - first.x, second.y - first.y);

export const getPinchMidpoint = (
  first: PdfZoomPoint,
  second: PdfZoomPoint,
): PdfZoomPoint => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
});

export const getPinchZoom = (
  initialZoom: number,
  initialDistance: number,
  currentDistance: number,
) =>
  initialDistance > 0
    ? clampPdfZoom(initialZoom * (currentDistance / initialDistance))
    : clampPdfZoom(initialZoom);

export const getFocalScrollPosition = ({
  pageLeft,
  pageTop,
  pageWidth,
  pageHeight,
  pageOffsetXRatio,
  pageOffsetYRatio,
  midpoint,
  viewportLeft,
  viewportTop,
  scrollLeft,
  scrollTop,
}: {
  pageLeft: number;
  pageTop: number;
  pageWidth: number;
  pageHeight: number;
  pageOffsetXRatio: number;
  pageOffsetYRatio: number;
  midpoint: PdfZoomPoint;
  viewportLeft: number;
  viewportTop: number;
  scrollLeft: number;
  scrollTop: number;
}) => {
  const pageDocumentLeft = pageLeft - viewportLeft + scrollLeft;
  const pageDocumentTop = pageTop - viewportTop + scrollTop;

  return {
    left:
      pageDocumentLeft +
      pageOffsetXRatio * Math.max(1, pageWidth) -
      (midpoint.x - viewportLeft),
    top:
      pageDocumentTop +
      pageOffsetYRatio * Math.max(1, pageHeight) -
      (midpoint.y - viewportTop),
  };
};
