import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DialogSurface } from './ui';

describe('DialogSurface', () => {
  it('renders only the primary action when no secondary action is provided', () => {
    render(
      <DialogSurface
        title="Downloading slides"
        body={<p>Preparing download...</p>}
        primaryLabel="Cancel download"
        onPrimary={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Cancel download' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep waiting' })).toBeNull();
  });

  it('renders the secondary action when provided', () => {
    render(
      <DialogSurface
        title="Delete event"
        body={<p>Confirm deletion.</p>}
        primaryLabel="Delete event"
        secondaryLabel="Cancel"
        onPrimary={vi.fn()}
        onSecondary={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});
