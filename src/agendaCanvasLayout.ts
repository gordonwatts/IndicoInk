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
  spanFullWidth: boolean;
  blockTopPx: number;
};

export type AgendaCanvasLayout = {
  columns: AgendaCanvasColumnLayout[];
  columnCount: number;
  columnWidthPx: number;
  canvasWidthPx: number;
  timeMarkers: number[];
  timeMarkerTopPx: number[];
  canvasHeightPx: number;
  startMinutes: number;
  endMinutes: number;
};

export const agendaCanvasRowHeight = 98;
export const agendaCanvasColumnWidth = 368;
export const agendaCanvasColumnMinWidth = 300;
export const agendaCanvasColumnMaxWidth = 420;
export const agendaTimeGutterWidth = 88;
export const agendaCanvasTrackPadding = 12;
export const agendaCanvasTalkMinHeight = 156;
export const agendaCanvasTalkGap = 12;
export const agendaCanvasHeaderHeight = 72;
const agendaCanvasTalkActionRowHeight = 40;
const agendaCanvasTalkLayoutSafetyPx = 8;

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
  return estimateAgendaTalkCardHeightForWidth(
    talk,
    agendaCanvasColumnWidth - agendaCanvasTrackPadding * 2,
  );
}

export function estimateAgendaTalkCardHeightForWidth(
  talk: AgendaTalkSummary,
  availableWidthPx: number,
) {
  const usableWidth = Math.max(144, availableWidthPx - 24);
  const approximateCharactersPerLine = Math.max(
    18,
    Math.floor(usableWidth / 8.3),
  );
  const titleLineCount = Math.min(
    3,
    Math.max(1, Math.ceil(talk.title.length / approximateCharactersPerLine)),
  );
  const speakerLineCount =
    talk.speaker.length > approximateCharactersPerLine * 1.15 ? 2 : 1;
  const summaryLineCount =
    talk.materialSummary.length > approximateCharactersPerLine * 0.8 ? 2 : 1;

  const hasMaterialActions = talk.materials.length > 0;

  return Math.max(
    agendaCanvasTalkMinHeight,
    122 +
      (titleLineCount - 1) * 22 +
      (speakerLineCount - 1) * 18 +
      (summaryLineCount - 1) * 16 +
      (hasMaterialActions ? agendaCanvasTalkActionRowHeight : 0) +
      agendaCanvasTalkLayoutSafetyPx,
  );
}

const sharedAgendaBlockPattern =
  /plenary|break|lunch|coffee|ceremony|registration|reception|poster|welcome|opening/i;
const agendaSessionBlockSplitGapMinutes = 30;

function isSharedAgendaBlock(
  title: string,
  room: string,
  talks: AgendaTalkSummary[],
) {
  const searchableText = [title, room, ...talks.map((talk) => talk.title)]
    .join(' ')
    .toLowerCase();
  return sharedAgendaBlockPattern.test(searchableText);
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

  const splitSessionTalks = (sessionTalks: AgendaTalkSummary[]) => {
    const orderedTalks = [...sessionTalks].sort(compareAgendaTalks);
    const blocks: AgendaTalkSummary[][] = [];

    orderedTalks.forEach((talk) => {
      const currentBlock = blocks.at(-1);
      const previousTalk = currentBlock?.at(-1);
      const previousEndMinutes = previousTalk
        ? getAgendaTalkEndMinutes(previousTalk)
        : null;
      const nextStartMinutes = getAgendaTalkStartMinutes(talk);

      if (
        currentBlock &&
        previousEndMinutes !== null &&
        nextStartMinutes !== null &&
        nextStartMinutes - previousEndMinutes >=
          agendaSessionBlockSplitGapMinutes
      ) {
        blocks.push([talk]);
        return;
      }

      if (currentBlock) {
        currentBlock.push(talk);
        return;
      }

      blocks.push([talk]);
    });

    return blocks;
  };

  return [...groupedTalks.entries()]
    .flatMap(([key, sessionTalks]) =>
      splitSessionTalks(sessionTalks).map((orderedTalks, splitIndex) => ({
        key: `${key}::${splitIndex}`,
        orderedTalks,
      })),
    )
    .map(({ key, orderedTalks }) => {
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
      const spanFullWidth = isSharedAgendaBlock(
        firstTalk?.sessionTitle ?? 'Session',
        firstTalk?.room ?? '',
        orderedTalks,
      );

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
        spanFullWidth,
        columnIndex: -1,
        blockTopPx: 0,
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
  availableWidthPx: number,
) {
  const orderedTalks = [...talks].sort(compareAgendaTalks);
  let cursorTop = agendaCanvasHeaderHeight + agendaCanvasTrackPadding;
  const talkPlacements = orderedTalks.map((talk) => {
    const heightPx = Math.max(
      estimateAgendaTalkCardHeightForWidth(talk, availableWidthPx),
      Math.round(
        (getAgendaTalkDurationMinutes(talk) / 30) * agendaCanvasRowHeight,
      ),
    );
    const placement = {
      talk,
      topPx: cursorTop,
      heightPx,
    };
    cursorTop += heightPx + agendaCanvasTalkGap;
    return placement;
  });

  const trackHeightPx = Math.max(
    agendaCanvasHeaderHeight + agendaCanvasTrackPadding * 2,
    cursorTop - agendaCanvasTalkGap + agendaCanvasTrackPadding,
  );

  return {
    orderedTalks,
    talkPlacements,
    trackHeightPx,
  };
}

function buildTimeBoundaries(
  blocks: Array<{
    startMinutes: number;
    endMinutes: number;
  }>,
  markerStart: number,
  markerEnd: number,
) {
  const boundaries = new Set<number>([markerStart, markerEnd]);
  for (let minute = markerStart; minute <= markerEnd; minute += 30) {
    boundaries.add(minute);
  }

  blocks.forEach((block) => {
    boundaries.add(block.startMinutes);
    boundaries.add(block.endMinutes);
  });

  return [...boundaries].sort((left, right) => left - right);
}

function buildTimeAxis(
  blocks: Array<{
    startMinutes: number;
    endMinutes: number;
    trackHeightPx: number;
  }>,
  markerStart: number,
  markerEnd: number,
) {
  const boundaries = buildTimeBoundaries(blocks, markerStart, markerEnd);
  const segmentHeights = boundaries.slice(0, -1).map((minute, index) => {
    const nextMinute = boundaries[index + 1] ?? minute + 30;
    return Math.max(
      1,
      Math.round(((nextMinute - minute) / 30) * agendaCanvasRowHeight),
    );
  });

  for (let iteration = 0; iteration < 8; iteration += 1) {
    let changed = false;

    blocks.forEach((block) => {
      const startIndex = boundaries.indexOf(block.startMinutes);
      const endIndex = boundaries.indexOf(block.endMinutes);
      if (startIndex < 0 || endIndex <= startIndex) {
        return;
      }

      const currentHeight = segmentHeights
        .slice(startIndex, endIndex)
        .reduce((total, height) => total + height, 0);
      if (currentHeight >= block.trackHeightPx) {
        return;
      }

      const deficit = block.trackHeightPx - currentHeight;
      const segmentCount = endIndex - startIndex;
      const extraPerSegment = Math.ceil(deficit / segmentCount);
      for (let index = startIndex; index < endIndex; index += 1) {
        segmentHeights[index] = (segmentHeights[index] ?? 1) + extraPerSegment;
      }
      changed = true;
    });

    if (!changed) {
      break;
    }
  }

  const boundaryTopPx = new Map<number, number>();
  let cursorTop = agendaCanvasHeaderHeight + agendaCanvasTrackPadding;
  boundaries.forEach((minute, index) => {
    boundaryTopPx.set(minute, cursorTop);
    cursorTop += segmentHeights[index] ?? 0;
  });

  const getTopForMinute = (minute: number) => {
    const exactTop = boundaryTopPx.get(minute);
    if (exactTop !== undefined) {
      return exactTop;
    }

    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const startMinute = boundaries[index]!;
      const endMinute = boundaries[index + 1]!;
      if (minute < startMinute || minute > endMinute) {
        continue;
      }

      const startTop = boundaryTopPx.get(startMinute) ?? cursorTop;
      const segmentHeight = segmentHeights[index] ?? agendaCanvasRowHeight;
      const fraction =
        (minute - startMinute) / Math.max(1, endMinute - startMinute);
      return startTop + fraction * segmentHeight;
    }

    return minute < boundaries[0]!
      ? (boundaryTopPx.get(boundaries[0]!) ?? 0)
      : cursorTop;
  };

  return {
    boundaries,
    getTopForMinute,
    heightPx: cursorTop + agendaCanvasTrackPadding,
  };
}

export function getResponsiveAgendaColumnWidth(
  viewportWidthPx: number,
  columnCount: number,
) {
  const usableWidthPx = Math.max(
    0,
    viewportWidthPx - agendaTimeGutterWidth - 16,
  );
  const targetVisibleColumns =
    viewportWidthPx >= 1200 ? 2 : viewportWidthPx >= 800 ? 2 : 1.25;
  const rawWidthPx = Math.floor(usableWidthPx / targetVisibleColumns);

  if (columnCount <= 1) {
    return Math.max(
      agendaCanvasColumnMinWidth,
      Math.min(Math.max(usableWidthPx, agendaCanvasColumnMinWidth), 640),
    );
  }

  return Math.max(
    agendaCanvasColumnMinWidth,
    Math.min(agendaCanvasColumnMaxWidth, rawWidthPx),
  );
}

export function buildAgendaCanvasLayout(
  talks: AgendaTalkSummary[],
  options: { columnWidthPx?: number } = {},
): AgendaCanvasLayout {
  const blocks = buildSessionBlocks(talks);
  const sessionBlocks = blocks.filter((block) => !block.spanFullWidth);
  const sharedBlocks = blocks.filter((block) => block.spanFullWidth);
  const globalStartMinutes =
    blocks
      .map((block) => block.startMinutes)
      .sort((left, right) => left - right)[0] ?? 8 * 60;
  const globalEndMinutes =
    blocks
      .map((block) => block.endMinutes)
      .sort((left, right) => right - left)[0] ?? globalStartMinutes + 180;

  const positionedSessionBlocks = sessionBlocks.map((block) => {
    return {
      ...block,
      spanFullWidth: false,
    };
  });

  const activeColumns: Array<{ endMinutes: number; columnIndex: number }> = [];
  const positionedBlocks = positionedSessionBlocks.map((block) => {
    activeColumns.sort((left, right) => left.endMinutes - right.endMinutes);

    for (let index = activeColumns.length - 1; index >= 0; index -= 1) {
      const activeColumn = activeColumns[index];
      if (activeColumn && activeColumn.endMinutes <= block.startMinutes) {
        activeColumns.splice(index, 1);
      }
    }

    const usedColumns = new Set(
      activeColumns.map((entry) => entry.columnIndex),
    );
    let columnIndex = 0;
    while (usedColumns.has(columnIndex)) {
      columnIndex += 1;
    }

    activeColumns.push({
      endMinutes: block.endMinutes,
      columnIndex,
    });

    return {
      ...block,
      columnIndex,
    };
  });

  const columnCount =
    positionedBlocks.reduce((maxColumns, block) => {
      const blockColumns = block.columnIndex + 1;
      return Math.max(maxColumns, blockColumns);
    }, 1) || 1;

  const columnWidthPx = options.columnWidthPx ?? agendaCanvasColumnWidth;
  const canvasWidthPx = agendaTimeGutterWidth + columnWidthPx * columnCount;

  const allBlocks = [...positionedBlocks, ...sharedBlocks].sort(
    (left, right) => {
      if (left.startMinutes !== right.startMinutes) {
        return left.startMinutes - right.startMinutes;
      }

      if (left.spanFullWidth !== right.spanFullWidth) {
        return left.spanFullWidth ? 1 : -1;
      }

      return left.title.localeCompare(right.title);
    },
  );

  const solvedBlocks = allBlocks.map((block) => {
    const solved = buildColumnPlacements(
      block.talks,
      block.spanFullWidth
        ? Math.max(240, canvasWidthPx - agendaTimeGutterWidth - 24)
        : Math.max(240, columnWidthPx - 24),
    );

    return {
      ...block,
      columnIndex: block.spanFullWidth ? -1 : block.columnIndex,
      talks: solved.orderedTalks,
      talkPlacements: solved.talkPlacements,
      trackHeightPx: solved.trackHeightPx,
    };
  });

  const timeMarkers: number[] = [];
  const markerStart = Math.floor(globalStartMinutes / 30) * 30;
  const markerEnd = Math.ceil(globalEndMinutes / 30) * 30;
  for (let minute = markerStart; minute <= markerEnd; minute += 30) {
    timeMarkers.push(minute);
  }

  const timeAxis = buildTimeAxis(solvedBlocks, markerStart, markerEnd);
  const timeMarkerTopPx = timeMarkers.map((minute) =>
    timeAxis.getTopForMinute(minute),
  );
  const lastBottomByColumn = new Map<number, number>();
  const axisAlignedColumns = solvedBlocks.map((block) => {
    const timeAlignedTopPx = timeAxis.getTopForMinute(block.startMinutes);
    const previousBottomPx =
      block.columnIndex >= 0
        ? (lastBottomByColumn.get(block.columnIndex) ?? 0)
        : 0;
    const blockTopPx = Math.max(timeAlignedTopPx, previousBottomPx);

    if (block.columnIndex >= 0) {
      lastBottomByColumn.set(
        block.columnIndex,
        blockTopPx + block.trackHeightPx,
      );
    }

    return {
      ...block,
      blockTopPx,
    };
  }) satisfies AgendaCanvasColumnLayout[];
  const canvasHeightPx = Math.max(
    axisAlignedColumns.reduce(
      (maxHeight, block) =>
        Math.max(maxHeight, block.blockTopPx + block.trackHeightPx),
      agendaCanvasHeaderHeight + agendaCanvasTrackPadding * 2,
    ),
    timeAxis.heightPx,
  );

  return {
    columns: axisAlignedColumns,
    columnCount: Math.max(1, columnCount),
    columnWidthPx,
    canvasWidthPx,
    timeMarkers,
    timeMarkerTopPx,
    canvasHeightPx,
    startMinutes: globalStartMinutes,
    endMinutes: globalEndMinutes,
  };
}
