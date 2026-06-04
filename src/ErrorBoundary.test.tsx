import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function ThrowingChild(): ReactElement {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  it('shows a recoverable error surface', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(
      screen.getByRole('heading', { name: 'Something went wrong.' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload app' })).toBeTruthy();
    expect(screen.getByText('render failed')).toBeTruthy();
  });
});
