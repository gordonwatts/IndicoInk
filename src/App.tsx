import React from 'react';

import type { AppInfo } from './shared/appInfo';

export function App() {
  const [info, setInfo] = React.useState<AppInfo | null>(null);

  React.useEffect(() => {
    void window.indicoInk.getAppInfo().then(setInfo);
  }, []);

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">IndicoInk</p>
        <h1>Conference notes for slide decks.</h1>
        <p className="lede">
          This is the initial Electron Forge + Vite + React shell with a typed
          preload bridge.
        </p>
        <button
          className="primary"
          type="button"
          onClick={() => void window.indicoInk.getAppInfo().then(setInfo)}
        >
          Refresh app info
        </button>
      </section>

      <section className="card" aria-label="App information">
        <h2>Runtime</h2>
        <dl>
          <div>
            <dt>App name</dt>
            <dd>{info?.appName ?? 'Loading...'}</dd>
          </div>
          <div>
            <dt>App version</dt>
            <dd>{info?.appVersion ?? 'Loading...'}</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{info?.electronVersion ?? 'Loading...'}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
