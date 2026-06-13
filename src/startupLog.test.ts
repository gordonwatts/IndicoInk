import { describe, expect, it, vi } from 'vitest';

import { formatStartupLogEntry } from './startupLog';

describe('formatStartupLogEntry', () => {
  it('includes the source label and redacts sensitive structured details', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T00:00:00.000Z'));

    const result = formatStartupLogEntry(
      'uncaughtException',
      {
        apiKey: 'super-secret',
        annotation: {
          text: 'private note',
          points: [{ x: 0.1, y: 0.2 }],
        },
        error: new Error('boom'),
      },
    );

    expect(result).toContain('"source":"uncaughtException"');
    expect(result).toContain('"apiKey":"[redacted]"');
    expect(result).toContain('"annotation":"[redacted]"');
    expect(result).toContain('"message":"boom"');
    expect(result).toContain('2026-06-04T00:00:00.000Z');

    vi.useRealTimers();
  });
});
