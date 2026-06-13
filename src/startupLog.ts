import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const sensitiveKeyPattern =
  /api[_-]?key|authorization|password|secret|token|annotation|points|text|payload/i;

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
) => {
  try {
    appendFileSync(join(logDir, 'startup.log'), formatStartupLogEntry(source, detail));
  } catch {
    // Logging must never block startup or crash reporting.
  }
};
