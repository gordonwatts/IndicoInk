import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sensitiveKeyPattern =
  /api[_-]?key|authorization|password|secret|token|annotation|points|text|payload/i;

export const startupLogFileName = 'startup.log';
export const maxStartupLogBytes = 5 * 1024 * 1024;

const sanitizeValue = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => sanitizeValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveKeyPattern.test(key) ? '[redacted]' : sanitizeValue(entry),
      ]),
    );
  }

  return value;
};

const sanitizeString = (value: string) => {
  if (value.length <= 2_000) {
    return value;
  }

  return `${value.slice(0, 2_000)}...[truncated]`;
};

export const formatStartupLogEntry = (source: string, detail: unknown) =>
  `${JSON.stringify({
    timestamp: new Date().toISOString(),
    source,
    detail: sanitizeValue(detail),
  })}\n`;

export const appendStartupLogEntry = (
  logDir: string,
  source: string,
  detail: unknown,
  options: {
    enabled?: boolean;
    force?: boolean;
  } = {},
) => {
  if (!options.force && !options.enabled) {
    return;
  }

  try {
    mkdirSync(logDir, { recursive: true });

    const logPath = join(logDir, startupLogFileName);
    const entry = Buffer.from(formatStartupLogEntry(source, detail), 'utf8');
    const currentLog = existsSync(logPath) ? readFileSync(logPath) : Buffer.alloc(0);
    const maxTailBytes = Math.max(0, maxStartupLogBytes - entry.length);

    if (currentLog.length + entry.length > maxStartupLogBytes) {
      let tail = currentLog.subarray(Math.max(0, currentLog.length - maxTailBytes));
      const firstLineBreak = tail.indexOf(0x0a);
      if (firstLineBreak >= 0) {
        tail = tail.subarray(firstLineBreak + 1);
      }

      writeFileSync(logPath, Buffer.concat([tail, entry]));
      return;
    }

    appendFileSync(logPath, entry);
  } catch {
    // Logging must never block startup or crash reporting.
  }
};
