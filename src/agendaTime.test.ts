import { describe, expect, it } from 'vitest';

import {
  formatAgendaDayLabel,
  formatAgendaTimeRange,
  parseWallClockTimeInZone,
} from './agendaTime';

describe('agenda time zones', () => {
  it('converts an Indico wall-clock time into the correct instant', () => {
    expect(
      parseWallClockTimeInZone('2026-07-07', '15:25:00', 'Europe/Paris'),
    ).toBe(Date.UTC(2026, 6, 7, 13, 25, 0, 0));
  });

  it('uses the correct offset on both sides of a daylight-saving change', () => {
    expect(
      parseWallClockTimeInZone('2026-01-07', '15:25:00', 'Europe/Paris'),
    ).toBe(Date.UTC(2026, 0, 7, 14, 25, 0, 0));
    expect(
      parseWallClockTimeInZone('2026-07-07', '15:25:00', 'Europe/Paris'),
    ).toBe(Date.UTC(2026, 6, 7, 13, 25, 0, 0));
  });

  it('formats a timestamp in a requested time zone', () => {
    const timestamp = Date.UTC(2026, 6, 7, 13, 25, 0, 0);

    expect(
      formatAgendaTimeRange(timestamp, timestamp + 10 * 60_000, 'Europe/Paris'),
    ).toBe('15:25 - 15:35');
    expect(
      formatAgendaTimeRange(
        timestamp,
        timestamp + 10 * 60_000,
        'America/Phoenix',
      ),
    ).toBe('06:25 - 06:35');
    expect(formatAgendaDayLabel(timestamp, 'Europe/Paris')).toBe(
      'Tuesday, July 7, 2026',
    );
  });
});
