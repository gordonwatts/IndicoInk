import { describe, expect, it } from 'vitest';

import {
  agendaCanvasHeaderHeight,
  agendaCanvasRowHeight,
  agendaTimeGutterWidth,
  buildAgendaCanvasLayout,
  getResponsiveAgendaColumnWidth,
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
  it('expands crowded half-hour intervals beyond the fixed base scale', () => {
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
    expect(firstDelta).toBeGreaterThan(agendaCanvasRowHeight);
    expect(secondDelta).toBeGreaterThanOrEqual(agendaCanvasRowHeight);
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

  it('marks shared agenda blocks so they can span the full canvas', () => {
    const layout = buildAgendaCanvasLayout([
      makeTalk(
        'shared-talk',
        12,
        15,
        75,
        'Lunch and poster previews',
        'Lunch and poster previews',
      ),
      makeTalk('session-talk', 12, 15, 30, 'Parallel talk', 'Parallel session'),
    ]);

    const sharedBlock = layout.columns.find((block) =>
      block.title.includes('Lunch'),
    );
    expect(sharedBlock?.spanFullWidth).toBe(true);
    expect(sharedBlock?.columnIndex).toBe(-1);
  });

  it('positions sequential same-column sessions at their own start times', () => {
    const layout = buildAgendaCanvasLayout([
      makeTalk('morning-talk', 9, 0, 30, 'Morning talk', 'Morning session'),
      makeTalk('midday-talk', 12, 0, 30, 'Midday talk', 'Midday session'),
      makeTalk(
        'afternoon-talk',
        15,
        0,
        30,
        'Afternoon talk',
        'Afternoon session',
      ),
    ]);

    const sessionBlocks = layout.columns.filter(
      (block) => !block.spanFullWidth,
    );
    expect(sessionBlocks).toHaveLength(3);
    expect(sessionBlocks[0]?.blockTopPx).toBeLessThan(
      sessionBlocks[1]?.blockTopPx ?? 0,
    );
    expect(sessionBlocks[1]?.blockTopPx).toBeLessThan(
      sessionBlocks[2]?.blockTopPx ?? 0,
    );
  });

  it('keeps repeated parallel session slots separate after a break', () => {
    const layout = buildAgendaCanvasLayout([
      makeTalk('track-1-a', 14, 30, 20, 'Track 1 first talk', 'Track 1'),
      makeTalk('track-1-b', 15, 0, 20, 'Track 1 second talk', 'Track 1'),
      makeTalk('track-2-a', 14, 30, 20, 'Track 2 first talk', 'Track 2'),
      makeTalk('track-2-b', 15, 0, 20, 'Track 2 second talk', 'Track 2'),
      makeTalk('track-3-a', 14, 30, 20, 'Track 3 first talk', 'Track 3'),
      makeTalk('track-3-b', 15, 0, 20, 'Track 3 second talk', 'Track 3'),
      makeTalk('track-1-c', 16, 40, 20, 'Track 1 third talk', 'Track 1'),
      makeTalk('track-2-c', 16, 40, 20, 'Track 2 third talk', 'Track 2'),
      makeTalk('track-3-c', 16, 40, 20, 'Track 3 third talk', 'Track 3'),
    ]);

    const trackBlocks = layout.columns.filter((block) =>
      block.title.startsWith('Track'),
    );

    expect(trackBlocks).toHaveLength(6);
    expect(
      trackBlocks.filter((block) => block.startMinutes === 14 * 60 + 30),
    ).toHaveLength(3);
    expect(
      trackBlocks.filter((block) => block.startMinutes === 16 * 60 + 40),
    ).toHaveLength(3);
    expect(layout.columnCount).toBe(3);
    expect(
      trackBlocks.every((block) => block.trackHeightPx < layout.canvasHeightPx),
    ).toBe(true);

    const firstSlotTrackBlock = trackBlocks.find(
      (block) => block.startMinutes === 14 * 60 + 30,
    );
    const firstSlotMarkerIndex = layout.timeMarkers.indexOf(14 * 60 + 30);
    expect(firstSlotMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(Math.round(firstSlotTrackBlock?.blockTopPx ?? -1)).toBe(
      Math.round(layout.timeMarkerTopPx[firstSlotMarkerIndex] ?? -2),
    );
  });

  it('widens a single-column day and tightens multi-column days responsively', () => {
    expect(getResponsiveAgendaColumnWidth(1500, 1)).toBeGreaterThan(
      getResponsiveAgendaColumnWidth(1500, 3),
    );
    expect(getResponsiveAgendaColumnWidth(1024, 3)).toBeLessThanOrEqual(420);
    expect(getResponsiveAgendaColumnWidth(1024, 3)).toBeGreaterThanOrEqual(300);
    expect(getResponsiveAgendaColumnWidth(700, 2)).toBeGreaterThanOrEqual(
      agendaTimeGutterWidth / 2,
    );
  });
});
