import type { AppInfo } from './shared/appInfo';
import type { PdfSelection } from './openPdf';

declare global {
  interface Window {
    indicoInk: {
      getAppInfo: () => Promise<AppInfo>;
      openPdf: () => Promise<PdfSelection>;
    };
  }
}

export {};
