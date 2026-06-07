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
      openPdf: vi.fn().mockResolvedValue({
        canceled: true,
        filePath: null,
      }),
      readPdfBytes: vi.fn().mockResolvedValue(new Uint8Array()),
      loadPdfWorkspaceState: vi.fn().mockResolvedValue(null),
      savePdfWorkspaceState: vi.fn().mockResolvedValue({
        sourceUrl: '',
        pageCount: 0,
        savedAt: Date.now(),
      }),
    };
  });

  it('renders the empty library view with URL validation', async () => {
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

    expect(
      screen.getByRole('button', {
        name: 'Open event',
      }),
    ).toBeTruthy();
    expect(screen.getByText('No saved events yet')).toBeTruthy();

    await user.type(
      screen.getByRole('textbox', {
        name: 'Event URL',
      }),
      'http://example.com/not-an-indico-event',
    );

    expect(
      screen.getByText('Use an https:// Indico event URL.'),
    ).toBeTruthy();

    await user.clear(
      screen.getByRole('textbox', {
        name: 'Event URL',
      }),
    );
    await user.type(
      screen.getByRole('textbox', {
        name: 'Event URL',
      }),
      'https://indico.example.org/event/example-2026',
    );

    expect(
      screen.queryByText('Use an https:// Indico event URL.'),
    ).toBeNull();

    await user.click(
      screen.getByRole('button', {
        name: 'Open event',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Event agenda',
      }),
    ).toBeTruthy();
  });

  it('supports keyboard navigation into the shell destinations', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: 'Library',
      }),
    );

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: 'Agenda',
      }),
    );

    await user.keyboard('{Enter}');

    expect(
      screen.getByRole('heading', {
        name: 'Event agenda',
      }),
    ).toBeTruthy();
  });
});
