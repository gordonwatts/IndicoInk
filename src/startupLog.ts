import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export const formatStartupLogEntry = (source: string, error: unknown) => {
  const detail =
    error instanceof Error
      ? (error.stack ?? error.message)
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  return `[${new Date().toISOString()}] ${source}: ${detail}\n`;
};

export const appendStartupLogEntry = (
  logDir: string,
  source: string,
  error: unknown,
) => {
  try {
    appendFileSync(
      join(logDir, 'startup.log'),
      formatStartupLogEntry(source, error),
    );
  } catch {
    // Logging must never block startup or crash reporting.
  }
};
