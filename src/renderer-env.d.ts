import type { AppInfo } from './shared/appInfo';

declare global {
  interface Window {
    indicoInk: {
      getAppInfo: () => Promise<AppInfo>;
    };
  }
}

export {};
