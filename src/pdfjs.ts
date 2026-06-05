import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

export const getPdfWorkerSrc = () => pdfWorkerUrl;

export const configurePdfJsCompatibility = () => {
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  return {
    workerSrc: pdfWorkerUrl,
  };
};
