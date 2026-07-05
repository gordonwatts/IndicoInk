import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  appendStartupLogEntry,
  formatStartupLogEntry,
  maxStartupLogBytes,
  startupLogFileName,
} from './startupLog';

describe('formatStartupLogEntry', () => {
  it('includes the source label and redacts sensitive structured details', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T00:00:00.000Z'));

    const result = formatStartupLogEntry('uncaughtException', {
      apiKey: 'super-secret',
      annotation: {
        text: 'private note',
        points: [{ x: 0.1, y: 0.2 }],
      },
      error: new Error('boom'),
    });

    expect(result).toContain('"source":"uncaughtException"');
    expect(result).toContain('"apiKey":"[redacted]"');
    expect(result).toContain('"annotation":"[redacted]"');
    expect(result).toContain('"message":"boom"');
    expect(result).toContain('2026-06-04T00:00:00.000Z');

    vi.useRealTimers();
  });
});

describe('appendStartupLogEntry', () => {
  it('skips logging when the feature is disabled', () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'indicoink-log-'));

    appendStartupLogEntry(userDataDir, 'window:create', 'dev-server');

    expect(existsSync(join(userDataDir, startupLogFileName))).toBe(false);
  });

  it('always writes forced errors', () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'indicoink-log-'));

    appendStartupLogEntry(userDataDir, 'uncaughtException', new Error('boom'), {
      force: true,
    });

    const logContents = readFileSync(join(userDataDir, startupLogFileName), 'utf8');
    expect(logContents).toContain('"source":"uncaughtException"');
    expect(logContents).toContain('"message":"boom"');
  });

  it('keeps the log capped at 5 MB and preserves the latest entry', () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'indicoink-log-'));
    const logPath = join(userDataDir, startupLogFileName);
    writeFileSync(logPath, Buffer.alloc(maxStartupLogBytes - 32, 'a'));

    appendStartupLogEntry(userDataDir, 'window:ready-to-show', 'showing window', {
      enabled: true,
    });

    const logBytes = readFileSync(logPath);
    expect(logBytes.length).toBeLessThanOrEqual(maxStartupLogBytes);
    expect(logBytes.toString('utf8')).toContain('"source":"window:ready-to-show"');
  });
});
