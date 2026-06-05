import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    window.indicoInk = {
      getAppInfo: vi.fn().mockResolvedValue({
        appName: 'IndicoInk',
        appVersion: '0.1.0',
        electronVersion: '42.3.2',
      }),
    };
  });

  it('renders the V1 shell with reachable destinations', async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(
      screen.getByRole('button', {
        name: 'Library',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Agenda',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Bookmarks',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Annotated',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Settings',
      }),
    ).toBeTruthy();

    expect(
      screen.getByRole('heading', {
        name: 'Open a conference event',
      }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: 'Agenda',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Event agenda',
      }),
    ).toBeTruthy();
    expect(screen.getByText('Current event active')).toBeTruthy();
  });
});
