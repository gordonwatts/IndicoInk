import type { AgendaTalkSummary } from './shared/agenda';

export type AgendaCanvasTalkPlacement = {
  talk: AgendaTalkSummary;
  topPx: number;
  heightPx: number;
};

export type AgendaCanvasColumnLayout = {
  key: string;
  title: string;
  room: string;
  dayLabel: string;
  startMinutes: number;
  endMinutes: number;
  startLabel: string;
  endLabel: string;
  talks: AgendaTalkSummary[];
  talkPlacements: AgendaCanvasTalkPlacement[];
  trackHeightPx: number;
  columnIndex: number;
};

export type AgendaCanvasLayout = {
  columns: AgendaCanvasColumnLayout[];
  columnCount: number;
  timeMarkers: number[];
  timeMarkerTopPx: number[];
  canvasHeightPx: number;
  startMinutes: number;
  endMinutes: number;
};

export const agendaCanvasRowHeight = 98;
export const agendaCanvasColumnWidth = 368;
export const agendaTimeGutterWidth = 88;
export const agendaCanvasTrackPadding = 12;
export const agendaCanvasTalkMinHeight = 156;
export const agendaCanvasTalkGap = 12;
export const agendaCanvasHeaderHeight = 72;

type TalkRange = {
  startMinutes: number | null;
  endMinutes: number | null;
};

export function parseAgendaTimeRange(timeRangeLabel: string): TalkRange {
  const matches = [...timeRangeLabel.matchAll(/(\d{1,2}):(\d{2})/g)];
  const startMinutes = matches[0]
    ? Number(matches[0][1]) * 60 + Number(matches[0][2])
    : null;
  const endMinutes = matches[1]
    ? Number(matches[1][1]) * 60 + Number(matches[1][2])
    : null;

  return {
    startMinutes,
    endMinutes,
  };
}

export function formatAgendaClockFromMinutes(minutes: number) {
  const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const mins = normalizedMinutes % 60;
  const suffixHours = hours.toString().padStart(2, '0');
  const suffixMinutes = mins.toString().padStart(2, '0');
  return `${suffixHours}:${suffixMinutes}`;
}

export function getAgendaTalkStartMinutes(talk: AgendaTalkSummary) {
  if (talk.sortStartsAt !== null) {
    const startsAt = new Date(talk.sortStartsAt);
    return startsAt.getUTCHours() * 60 + startsAt.getUTCMinutes();
  }

  return parseAgendaTimeRange(talk.timeRangeLabel).startMinutes;
}

export function getAgendaTalkEndMinutes(talk: AgendaTalkSummary) {
  const parsedRange = parseAgendaTimeRange(talk.timeRangeLabel);
  if (parsedRange.endMinutes !== null) {
    return parsedRange.endMinutes;
  }

  const startMinutes =
    parsedRange.startMinutes ?? getAgendaTalkStartMinutes(talk) ?? 0;
  return startMinutes + 30;
}

export function getAgendaTalkDurationMinutes(talk: AgendaTalkSummary) {
  const startMinutes = getAgendaTalkStartMinutes(talk) ?? 0;
  const endMinutes = getAgendaTalkEndMinutes(talk);
  return Math.max(15, endMinutes - startMinutes);
}

export function estimateAgendaTalkCardHeight(talk: AgendaTalkSummary) {
  const titleLineCount = Math.min(
    3,
    Math.max(1, Math.ceil(talk.title.length / 26)),
  );
  const speakerLineCount = talk.speaker.length > 34 ? 2 : 1;
  const summaryLineCount = talk.materialSummary.length > 16 ? 2 : 1;

  return Math.max(
    agendaCanvasTalkMinHeight,
    128 +
      (titleLineCount - 1) * 22 +
      (speakerLineCount - 1) * 18 +
      (summaryLineCount - 1) * 16,
  );
}

function compareAgendaTalks(left: AgendaTalkSummary, right: AgendaTalkSummary) {
  const leftStart = getAgendaTalkStartMinutes(left) ?? Number.MAX_SAFE_INTEGER;
  const rightStart =
    getAgendaTalkStartMinutes(right) ?? Number.MAX_SAFE_INTEGER;

  if (leftStart !== rightStart) {
    return leftStart - rightStart;
  }

  const leftEnd = getAgendaTalkEndMinutes(left);
  const rightEnd = getAgendaTalkEndMinutes(right);
  if (leftEnd !== rightEnd) {
    return leftEnd - rightEnd;
  }

  return left.title.localeCompare(right.title);
}

function buildSessionBlocks(talks: AgendaTalkSummary[]) {
  const groupedTalks = new Map<string, AgendaTalkSummary[]>();

  talks.forEach((talk) => {
    const key = `${talk.dayLabel}::${talk.sessionTitle}::${talk.room}`;
    const bucket = groupedTalks.get(key) ?? [];
    bucket.push(talk);
    groupedTalks.set(key, bucket);
  });

  return [...groupedTalks.entries()]
    .map(([key, sessionTalks]) => {
      const orderedTalks = [...sessionTalks].sort(compareAgendaTalks);

      const startMinutes =
        orderedTalks
          .map((talk) => getAgendaTalkStartMinutes(talk))
          .filter((value): value is number => value !== null)
          .sort((left, right) => left - right)[0] ?? 0;

      const endMinutes =
        orderedTalks
          .map((talk) => getAgendaTalkEndMinutes(talk))
          .filter((value): value is number => value !== null)
          .sort((left, right) => right - left)[0] ?? startMinutes + 30;

      const firstTalk = orderedTalks[0] ?? null;

      return {
        key,
        title: firstTalk?.sessionTitle ?? 'Session',
        room: firstTalk?.room ?? 'Room unavailable',
        dayLabel: firstTalk?.dayLabel ?? 'Unknown day',
        startMinutes,
        endMinutes,
        startLabel: formatAgendaClockFromMinutes(startMinutes),
        endLabel: formatAgendaClockFromMinutes(endMinutes),
        talks: orderedTalks,
      };
    })
    .sort((left, right) => {
      if (left.startMinutes !== right.startMinutes) {
        return left.startMinutes - right.startMinutes;
      }

      return left.title.localeCompare(right.title);
    });
}

function buildColumnPlacements(
  talks: AgendaTalkSummary[],
  globalStartMinutes: number,
  globalEndMinutes: number,
) {
  const orderedTalks = [...talks].sort(compareAgendaTalks);
  const idealHeights = orderedTalks.map((talk) =>
    Math.max(
      estimateAgendaTalkCardHeight(talk),
      Math.round(
        (getAgendaTalkDurationMinutes(talk) / 30) * agendaCanvasRowHeight,
      ),
    ),
  );

  const talkPlacements: AgendaCanvasTalkPlacement[] = orderedTalks.map(
    (talk) => ({
      talk,
      topPx: 0,
      heightPx: 0,
    }),
  );

  let currentHeights = [...idealHeights];
  const baseTopForMinutes = (minutes: number) =>
    agendaCanvasHeaderHeight +
    agendaCanvasTrackPadding +
    Math.round(((minutes - globalStartMinutes) / 30) * agendaCanvasRowHeight);

  for (let iteration = 0; iteration < 6; iteration += 1) {
    let cursorTop = baseTopForMinutes(globalStartMinutes);

    orderedTalks.forEach((talk, index) => {
      const startMinutes =
        getAgendaTalkStartMinutes(talk) ?? globalStartMinutes;
      const idealTop = baseTopForMinutes(startMinutes);
      const topPx = Math.max(idealTop, cursorTop);
      talkPlacements[index] = {
        talk,
        topPx,
        heightPx:
          currentHeights[index] ??
          idealHeights[index] ??
          agendaCanvasTalkMinHeight,
      };
      cursorTop = topPx + talkPlacements[index].heightPx + agendaCanvasTalkGap;
    });

    const nextHeights = orderedTalks.map((talk, index) => {
      const placement = talkPlacements[index]!;
      const nextTop =
        index < talkPlacements.length - 1
          ? talkPlacements[index + 1]!.topPx - agendaCanvasTalkGap
          : baseTopForMinutes(globalEndMinutes);
      return Math.max(
        idealHeights[index] ?? agendaCanvasTalkMinHeight,
        Math.round(nextTop - placement.topPx),
      );
    });

    const hasChanged = nextHeights.some(
      (height, index) => height !== currentHeights[index],
    );
    currentHeights = nextHeights;

    if (!hasChanged) {
      break;
    }
  }

  let trackHeightPx = agendaCanvasHeaderHeight + agendaCanvasTrackPadding;
  talkPlacements.forEach((placement, index) => {
    const heightPx = currentHeights[index] ?? agendaCanvasTalkMinHeight;
    placement.heightPx = heightPx;
    trackHeightPx = Math.max(
      trackHeightPx,
      placement.topPx + heightPx + agendaCanvasTrackPadding,
    );
  });

  return {
    orderedTalks,
    talkPlacements,
    trackHeightPx,
  };
}

function getTalkPlacementForMarker(
  column: AgendaCanvasColumnLayout,
  minute: number,
) {
  const currentTalk = column.talkPlacements.find(({ talk }) => {
    const startMinutes = getAgendaTalkStartMinutes(talk) ?? 0;
    const endMinutes = getAgendaTalkEndMinutes(talk);
    return startMinutes <= minute && minute <= endMinutes;
  });

  if (currentTalk) {
    return currentTalk;
  }

  const previousTalk = [...column.talkPlacements]
    .reverse()
    .find(({ talk }) => (getAgendaTalkStartMinutes(talk) ?? 0) <= minute);
  if (previousTalk) {
    return previousTalk;
  }

  return column.talkPlacements[0] ?? null;
}

function getColumnMarkerTopPx(
  column: AgendaCanvasColumnLayout,
  minute: number,
) {
  const placement = getTalkPlacementForMarker(column, minute);
  if (!placement) {
    return agendaCanvasHeaderHeight + agendaCanvasTrackPadding;
  }

  const talk = placement.talk;
  const startMinutes = getAgendaTalkStartMinutes(talk) ?? minute;
  const endMinutes = getAgendaTalkEndMinutes(talk);
  const durationMinutes = Math.max(1, endMinutes - startMinutes);
  const topPx = placement.topPx;
  const bottomPx = placement.topPx + placement.heightPx;

  if (minute <= startMinutes) {
    const beforeTalk = column.talkPlacements
      .filter(
        ({ talk: candidate }) =>
          (getAgendaTalkStartMinutes(candidate) ?? 0) < startMinutes,
      )
      .at(-1);

    if (beforeTalk) {
      const beforeEnd = getAgendaTalkEndMinutes(beforeTalk.talk);
      const beforeDeltaMinutes = Math.max(1, startMinutes - beforeEnd);
      const beforeBottom = beforeTalk.topPx + beforeTalk.heightPx;
      return (
        beforeBottom +
        ((minute - beforeEnd) / beforeDeltaMinutes) *
          Math.max(1, topPx - beforeBottom)
      );
    }

    return (
      topPx +
      ((minute - startMinutes) / durationMinutes) *
        Math.max(1, bottomPx - topPx)
    );
  }

  if (minute >= endMinutes) {
    const nextTalk = column.talkPlacements.find(
      ({ talk: candidate }) =>
        (getAgendaTalkStartMinutes(candidate) ?? Number.MAX_SAFE_INTEGER) >
        endMinutes,
    );

    if (nextTalk) {
      const nextStart = getAgendaTalkStartMinutes(nextTalk.talk) ?? endMinutes;
      const nextDeltaMinutes = Math.max(1, nextStart - endMinutes);
      const currentBottom = bottomPx;
      const nextTop = nextTalk.topPx;
      return (
        currentBottom +
        ((minute - endMinutes) / nextDeltaMinutes) *
          Math.max(1, nextTop - currentBottom)
      );
    }

    return (
      topPx +
      ((minute - startMinutes) / durationMinutes) *
        Math.max(1, bottomPx - topPx)
    );
  }

  const fraction = (minute - startMinutes) / durationMinutes;
  return topPx + fraction * Math.max(1, bottomPx - topPx);
}

function buildTimeMarkerTopPositions(
  columns: AgendaCanvasColumnLayout[],
  timeMarkers: number[],
) {
  if (!timeMarkers.length) {
    return [];
  }

  const getMedianPosition = (positions: number[]) => {
    const sorted = positions
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };

  const firstMarker = timeMarkers[0]!;
  const firstMarkerPositions = columns
    .filter(
      (column) =>
        firstMarker >= column.startMinutes && firstMarker <= column.endMinutes,
    )
    .map((column) => getColumnMarkerTopPx(column, firstMarker));
  const markerTopPx = [
    firstMarkerPositions.length
      ? getMedianPosition(firstMarkerPositions)
      : agendaCanvasHeaderHeight + agendaCanvasTrackPadding,
  ];

  for (let index = 1; index < timeMarkers.length; index += 1) {
    const previousMinute = timeMarkers[index - 1]!;
    const minute = timeMarkers[index]!;
    const previousTop = markerTopPx[index - 1]!;
    const intervalDeltas = columns
      .filter(
        (column) =>
          previousMinute >= column.startMinutes && minute <= column.endMinutes,
      )
      .map(
        (column) =>
          getColumnMarkerTopPx(column, minute) -
          getColumnMarkerTopPx(column, previousMinute),
      )
      .filter((delta) => Number.isFinite(delta) && delta > 0);

    const nextDelta = intervalDeltas.length
      ? getMedianPosition(intervalDeltas)
      : agendaCanvasRowHeight;
    markerTopPx.push(previousTop + Math.max(1, nextDelta));
  }

  return markerTopPx;
}

function getGlobalTopForMinute(
  timeMarkers: number[],
  timeMarkerTopPx: number[],
  minute: number,
) {
  if (!timeMarkers.length) {
    return agendaCanvasHeaderHeight + agendaCanvasTrackPadding;
  }

  const firstMarker = timeMarkers[0]!;
  if (minute <= firstMarker) {
    return timeMarkerTopPx[0] ?? 0;
  }

  for (let index = 1; index < timeMarkers.length; index += 1) {
    const previousMinute = timeMarkers[index - 1]!;
    const nextMinute = timeMarkers[index]!;
    if (minute > nextMinute) {
      continue;
    }

    const previousTop = timeMarkerTopPx[index - 1] ?? 0;
    const nextTop = timeMarkerTopPx[index] ?? previousTop;
    const minuteDelta = Math.max(1, nextMinute - previousMinute);
    const fraction = (minute - previousMinute) / minuteDelta;
    return previousTop + fraction * (nextTop - previousTop);
  }

  return timeMarkerTopPx.at(-1) ?? 0;
}

export function buildAgendaCanvasLayout(
  talks: AgendaTalkSummary[],
): AgendaCanvasLayout {
  const blocks = buildSessionBlocks(talks);
  const globalStartMinutes =
    blocks
      .map((block) => block.startMinutes)
      .sort((left, right) => left - right)[0] ?? 8 * 60;
  const globalEndMinutes =
    blocks
      .map((block) => block.endMinutes)
      .sort((left, right) => right - left)[0] ?? globalStartMinutes + 180;

  const columnLayouts = blocks.map((block, columnIndex) => {
    const solved = buildColumnPlacements(
      block.talks,
      globalStartMinutes,
      globalEndMinutes,
    );

    return {
      ...block,
      talks: solved.orderedTalks,
      talkPlacements: solved.talkPlacements,
      trackHeightPx: solved.trackHeightPx,
      columnIndex,
    } satisfies AgendaCanvasColumnLayout;
  });

  const timeMarkers: number[] = [];
  const markerStart = Math.floor(globalStartMinutes / 30) * 30;
  const markerEnd = Math.ceil(globalEndMinutes / 30) * 30;
  for (let minute = markerStart; minute <= markerEnd; minute += 30) {
    timeMarkers.push(minute);
  }

  const timeMarkerTopPx = buildTimeMarkerTopPositions(
    columnLayouts,
    timeMarkers,
  );
  const axisAlignedColumns = columnLayouts.map((block) => {
    const directStartTop = getColumnMarkerTopPx(block, block.startMinutes);
    const globalStartTop = getGlobalTopForMinute(
      timeMarkers,
      timeMarkerTopPx,
      block.startMinutes,
    );
    const offsetPx = Math.max(0, globalStartTop - directStartTop);
    const talkPlacements = block.talkPlacements.map((placement) => ({
      ...placement,
      topPx: placement.topPx + offsetPx,
    }));
    const trackHeightPx = block.trackHeightPx + offsetPx;

    return {
      ...block,
      talkPlacements,
      trackHeightPx,
    };
  });
  const lastMarkerTop = timeMarkerTopPx.at(-1) ?? 0;
  const canvasHeightPx = Math.max(
    axisAlignedColumns.reduce(
      (maxHeight, block) => Math.max(maxHeight, block.trackHeightPx),
      agendaCanvasHeaderHeight + agendaCanvasTrackPadding * 2,
    ),
    lastMarkerTop + agendaCanvasTrackPadding * 2,
  );

  const scaledColumns = axisAlignedColumns.map((block) => ({
    ...block,
    trackHeightPx: Math.max(block.trackHeightPx, canvasHeightPx),
  }));

  return {
    columns: scaledColumns,
    columnCount: Math.max(1, scaledColumns.length),
    timeMarkers,
    timeMarkerTopPx,
    canvasHeightPx,
    startMinutes: globalStartMinutes,
    endMinutes: globalEndMinutes,
  };
}
