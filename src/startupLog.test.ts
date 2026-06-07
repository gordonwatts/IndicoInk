import { describe, expect, it, vi } from 'vitest';

import { formatStartupLogEntry } from './startupLog';

describe('formatStartupLogEntry', () => {
  it('includes the source label and error message', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T00:00:00.000Z'));

    const result = formatStartupLogEntry(
      'uncaughtException',
      new Error('boom'),
    );

    expect(result).toContain('uncaughtException: Error: boom');
    expect(result).toContain('2026-06-04T00:00:00.000Z');

    vi.useRealTimers();
  });
});
