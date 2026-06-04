import React from 'react';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <main className="app-shell">
          <section className="hero">
            <p className="eyebrow">IndicoInk</p>
            <h1>Something went wrong.</h1>
            <p className="lede">
              The app hit a recoverable renderer error. Reload to try again.
            </p>
            <button
              className="primary"
              type="button"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload app
            </button>
          </section>
          <section className="card" aria-label="Error details">
            <h2>Renderer error</h2>
            <p>{this.state.error.message}</p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
