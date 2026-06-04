import { render, screen } from '@testing-library/react';
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

  it('renders the app shell and preload-backed runtime info', async () => {
    render(<App />);

    expect(
      screen.getByRole('heading', {
        name: 'Conference notes for slide decks.',
      }),
    ).toBeTruthy();
    expect(await screen.findByText('IndicoInk')).toBeTruthy();
    expect(await screen.findByText('0.1.0')).toBeTruthy();
    expect(await screen.findByText('42.3.2')).toBeTruthy();
  });
});
