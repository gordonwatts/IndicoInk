import type { AgendaTalkSummary } from './shared/agenda';

export type AgendaTimeZoneMode = 'event' | 'local';

const getTimeZoneOrUtc = (timeZone?: string) => {
  if (!timeZone) {
    return 'UTC';
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return timeZone;
  } catch {
    return 'UTC';
  }
};

const getDateTimeFormatter = (
  locale: string,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string,
) =>
  new Intl.DateTimeFormat(locale, {
    ...options,
    ...(timeZone ? { timeZone: getTimeZoneOrUtc(timeZone) } : {}),
  });

const getFormattedParts = (timestamp: number, timeZone: string) => {
  const formatter = getDateTimeFormatter(
    'en-US',
    {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    },
    timeZone,
  );

  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

const toUtcWallClockTimestamp = (parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}) =>
  Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );

export const parseWallClockTimeInZone = (
  dateText: string | undefined,
  timeText: string | undefined,
  timeZone = 'UTC',
) => {
  if (!dateText) {
    return null;
  }

  const [yearText, monthText, dayText] = dateText.split('-');
  if (!yearText || !monthText || !dayText) {
    return null;
  }

  const timeParts = timeText?.split(':') ?? [];
  const parts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(timeParts[0] ?? 0),
    minute: Number(timeParts[1] ?? 0),
    second: Number(timeParts[2] ?? 0),
  };

  if (Object.values(parts).some((value) => !Number.isFinite(value))) {
    return null;
  }

  const wallClockTimestamp = toUtcWallClockTimestamp(parts);
  let candidateTimestamp = wallClockTimestamp;
  const normalizedTimeZone = getTimeZoneOrUtc(timeZone);

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const formattedParts = getFormattedParts(
      candidateTimestamp,
      normalizedTimeZone,
    );
    const offset = toUtcWallClockTimestamp(formattedParts) - candidateTimestamp;
    const nextCandidateTimestamp = wallClockTimestamp - offset;
    if (nextCandidateTimestamp === candidateTimestamp) {
      break;
    }
    candidateTimestamp = nextCandidateTimestamp;
  }

  return candidateTimestamp;
};

export const formatAgendaClock = (
  timestamp: number | null,
  timeZone?: string,
) => {
  if (timestamp === null) {
    return null;
  }

  return getDateTimeFormatter(
    'en-GB',
    {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    },
    timeZone,
  ).format(new Date(timestamp));
};

export const formatAgendaTimeRange = (
  startsAt: number | null,
  endsAt: number | null,
  timeZone?: string,
) => {
  const startLabel = formatAgendaClock(startsAt, timeZone);
  const endLabel = formatAgendaClock(endsAt, timeZone);

  if (startLabel && endLabel) {
    return `${startLabel} - ${endLabel}`;
  }

  if (startLabel) {
    return `${startLabel} onward`;
  }

  if (endLabel) {
    return `Until ${endLabel}`;
  }

  return 'Time unavailable';
};

export const formatAgendaDayLabel = (
  timestamp: number | null,
  timeZone?: string,
) => {
  if (timestamp === null) {
    return 'Unknown day';
  }

  return getDateTimeFormatter(
    'en-US',
    {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    },
    timeZone,
  ).format(new Date(timestamp));
};

export const formatAgendaTalkForTimeZone = (
  talk: AgendaTalkSummary,
  mode: AgendaTimeZoneMode,
): AgendaTalkSummary => {
  if (talk.startsAt === undefined && talk.endsAt === undefined) {
    return talk;
  }

  if (mode === 'local' && !talk.eventTimeZone) {
    return talk;
  }

  const timeZone = mode === 'event' ? (talk.eventTimeZone ?? 'UTC') : undefined;
  const startsAt = talk.startsAt ?? null;
  const endsAt = talk.endsAt ?? null;

  return {
    ...talk,
    dayLabel: formatAgendaDayLabel(startsAt, timeZone),
    timeRangeLabel: formatAgendaTimeRange(startsAt, endsAt, timeZone),
  };
};
