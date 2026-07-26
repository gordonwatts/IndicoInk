import { describe, expect, it } from 'vitest';

import { createExportFileName } from './exportFileName';

describe('createExportFileName', () => {
  it('prefixes the title with the meeting start date', () => {
    expect(
      createExportFileName({
        dates: 'June 12, 2026 - June 14, 2026',
        title: 'IndicoInk Summit',
      }),
    ).toBe('2026-06-12 - IndicoInk Summit notes.md');
  });

  it('keeps the title-only fallback when no start date is available', () => {
    expect(
      createExportFileName({
        dates: 'Date unavailable',
        title: 'Local / Notes',
      }),
    ).toBe('Local Notes notes.md');
  });
});
