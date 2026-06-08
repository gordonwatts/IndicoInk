import { describe, expect, it } from 'vitest';

import {
  agendaCanvasHeaderHeight,
  buildAgendaCanvasLayout,
} from './agendaCanvasLayout';
import type { AgendaTalkSummary } from './shared/agenda';

function makeTalk(
  id: string,
  startHour: number,
  startMinute: number,
  durationMinutes: number,
  title: string,
  sessionTitle = 'Stacked session',
): AgendaTalkSummary {
  const endTotalMinutes = startHour * 60 + startMinute + durationMinutes;
  const endHour = Math.floor(endTotalMinutes / 60);
  const endMinute = endTotalMinutes % 60;

  return {
    id,
    conferenceId: 'conference-1',
    contributionId: id,
    sortStartsAt: Date.UTC(2026, 5, 12, startHour, startMinute, 0, 0),
    dayLabel: 'Friday, June 12, 2026',
    title,
    speaker: `${title} speaker`,
    sessionTitle,
    timeRangeLabel: `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')} - ${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`,
    room: 'Room A',
    bookmarked: false,
    materialSummary: 'PDF',
    materials: [],
    annotatedSlideCount: 0,
  };
}

describe('agenda canvas layout', () => {
  it('derives half-hour markers from the solved talk stack instead of a fixed scale', () => {
    const layout = buildAgendaCanvasLayout([
      makeTalk('talk-1', 8, 30, 10, 'Talk 1'),
      makeTalk('talk-2', 8, 40, 10, 'Talk 2'),
      makeTalk('talk-3', 8, 50, 10, 'Talk 3'),
      makeTalk('talk-4', 9, 0, 30, 'Talk 4'),
    ]);

    expect(layout.timeMarkers).toEqual([510, 540, 570]);
    expect(layout.timeMarkerTopPx).toHaveLength(3);
    expect(layout.timeMarkerTopPx[0]!).toBeLessThan(layout.timeMarkerTopPx[1]!);
    expect(layout.timeMarkerTopPx[1]!).toBeLessThan(layout.timeMarkerTopPx[2]!);

    const firstDelta = layout.timeMarkerTopPx[1]! - layout.timeMarkerTopPx[0]!;
    const secondDelta = layout.timeMarkerTopPx[2]! - layout.timeMarkerTopPx[1]!;
    expect(firstDelta).not.toBe(secondDelta);
  });

  it('ignores later columns when placing earlier time markers', () => {
    const layout = buildAgendaCanvasLayout([
      makeTalk('early-talk', 9, 0, 35, 'Early talk', 'Early session'),
      makeTalk('late-talk', 10, 30, 30, 'Late talk', 'Late session'),
    ]);

    expect(layout.timeMarkers[0]).toBe(540);
    expect(layout.timeMarkerTopPx[0]).toBeGreaterThanOrEqual(
      agendaCanvasHeaderHeight,
    );
  });
});
