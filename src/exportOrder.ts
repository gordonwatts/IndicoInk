import type { ExportTalkSnapshot } from './shared/exportNotes';

type ExportSession = {
  title: string;
  room: string;
  startsAt: number | null;
};

const getDayKey = (startsAt: number | null) =>
  startsAt === null
    ? 'unscheduled'
    : new Date(startsAt).toISOString().slice(0, 10);

const getSessionKey = (talk: ExportTalkSnapshot) =>
  `${getDayKey(talk.startsAt)}\u0000${talk.sessionTitle}\u0000${talk.room}`;

const compareNullableTime = (left: number | null, right: number | null) => {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left - right;
};

const compareText = (left: string, right: string) => left.localeCompare(right);

export const sortExportTalks = (talks: ExportTalkSnapshot[]) => {
  const sessions = new Map<string, ExportSession>();

  for (const talk of talks) {
    const key = getSessionKey(talk);
    const current = sessions.get(key);
    if (!current) {
      sessions.set(key, {
        title: talk.sessionTitle,
        room: talk.room,
        startsAt: talk.startsAt,
      });
      continue;
    }

    if (
      current.startsAt === null ||
      (talk.startsAt !== null && talk.startsAt < current.startsAt)
    ) {
      current.startsAt = talk.startsAt;
    }
  }

  const ordered = [...talks];
  ordered.sort((left, right) => {
    const leftSession = sessions.get(getSessionKey(left))!;
    const rightSession = sessions.get(getSessionKey(right))!;

    const sessionStartComparison = compareNullableTime(
      leftSession.startsAt,
      rightSession.startsAt,
    );
    if (sessionStartComparison !== 0) {
      return sessionStartComparison;
    }

    const dayComparison = compareText(
      getDayKey(left.startsAt),
      getDayKey(right.startsAt),
    );
    if (dayComparison !== 0) {
      return dayComparison;
    }

    const sessionTitleComparison = compareText(
      leftSession.title,
      rightSession.title,
    );
    if (sessionTitleComparison !== 0) {
      return sessionTitleComparison;
    }

    const roomComparison = compareText(leftSession.room, rightSession.room);
    if (roomComparison !== 0) {
      return roomComparison;
    }

    const talkStartComparison = compareNullableTime(
      left.startsAt,
      right.startsAt,
    );
    if (talkStartComparison !== 0) {
      return talkStartComparison;
    }

    const talkEndComparison = compareNullableTime(left.endsAt, right.endsAt);
    if (talkEndComparison !== 0) {
      return talkEndComparison;
    }

    return (
      compareText(left.title, right.title) || compareText(left.id, right.id)
    );
  });

  return ordered;
};
