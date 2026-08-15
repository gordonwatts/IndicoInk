import { describe, expect, it } from 'vitest';

import { sortExportTalks } from './exportOrder';
import type { ExportTalkSnapshot } from './shared/exportNotes';

const makeTalk = (
  id: string,
  title: string,
  sessionTitle: string,
  startsAt: number | null,
  room = 'Room A',
): ExportTalkSnapshot => ({
  id,
  contributionId: id,
  contributionUrl: `https://indico.example.org/talk/${id}`,
  title,
  speaker: 'Speaker',
  sessionTitle,
  startsAt,
  endsAt: startsAt === null ? null : startsAt + 30 * 60_000,
  room,
  bookmarked: false,
  decks: [],
});

describe('sortExportTalks', () => {
  it('orders sessions by start time and talks within each session by time', () => {
    const day = Date.UTC(2026, 5, 12);
    const talks = [
      makeTalk('beta-late', 'Beta late', 'Beta session', day + 45 * 60_000),
      makeTalk('alpha-late', 'Alpha late', 'Alpha session', day + 60 * 60_000),
      makeTalk(
        'alpha-early',
        'Alpha early',
        'Alpha session',
        day + 30 * 60_000,
      ),
      makeTalk('beta-early', 'Beta early', 'Beta session', day + 15 * 60_000),
    ];

    expect(sortExportTalks(talks).map((talk) => talk.id)).toEqual([
      'beta-early',
      'beta-late',
      'alpha-early',
      'alpha-late',
    ]);
  });

  it('uses a deterministic label tie-breaker for sessions that start together', () => {
    const start = Date.UTC(2026, 5, 12, 9);
    const talks = [
      makeTalk('zeta', 'Zeta talk', 'Zeta session', start),
      makeTalk('alpha', 'Alpha talk', 'Alpha session', start),
    ];

    expect(sortExportTalks(talks).map((talk) => talk.id)).toEqual([
      'alpha',
      'zeta',
    ]);
  });

  it('keeps later-day sessions after all earlier-day sessions with the same title', () => {
    const firstDay = Date.UTC(2026, 5, 12, 9);
    const secondDay = Date.UTC(2026, 5, 13, 9);
    const talks = [
      makeTalk('day-two', 'Day two', 'Track 1', secondDay),
      makeTalk(
        'day-one-other',
        'Day one other',
        'Track 2',
        firstDay + 60 * 60_000,
      ),
      makeTalk('day-one', 'Day one', 'Track 1', firstDay),
    ];

    expect(sortExportTalks(talks).map((talk) => talk.id)).toEqual([
      'day-one',
      'day-one-other',
      'day-two',
    ]);
  });

  it('places talks without times last', () => {
    const start = Date.UTC(2026, 5, 12, 9);
    const talks = [
      makeTalk('unscheduled', 'Unscheduled', 'Unscheduled', null),
      makeTalk('scheduled', 'Scheduled', 'Morning', start),
    ];

    expect(sortExportTalks(talks).map((talk) => talk.id)).toEqual([
      'scheduled',
      'unscheduled',
    ]);
  });
});
