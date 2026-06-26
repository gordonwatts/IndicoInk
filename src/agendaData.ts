import type { PersistenceStore } from './persistenceStore';
import type { AgendaTalkSummary } from './shared/agenda';

const agendaClockFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

const agendaDayLabelFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const formatAgendaClock = (timestamp: number | null) => {
  if (timestamp === null) {
    return null;
  }

  return agendaClockFormatter.format(new Date(timestamp));
};

const formatAgendaTimeRange = (
  startsAt: number | null,
  endsAt: number | null,
) => {
  const startLabel = formatAgendaClock(startsAt);
  const endLabel = formatAgendaClock(endsAt);

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

const formatAgendaDayLabel = (timestamp: number | null) => {
  if (timestamp === null) {
    return 'Unknown day';
  }

  return agendaDayLabelFormatter.format(new Date(timestamp));
};

const formatMaterialSummary = (pdfDeckCount: number) => {
  if (pdfDeckCount === 0) {
    return 'No slides';
  }

  if (pdfDeckCount === 1) {
    return 'PDF';
  }

  return `${pdfDeckCount} PDFs`;
};

export const buildAgendaTalkSummaries = async (
  store: PersistenceStore,
  conferenceId: string,
): Promise<AgendaTalkSummary[]> => {
  const talks = await store.listTalksByConference(conferenceId);

  const summaries = await Promise.all(
    talks.map(async (talk) => {
      const decks = await store.listDecksByTalk(talk.id);
      const pdfDecks = decks.filter(
        (deck) => deck.mimeType === 'application/pdf',
      );

      const annotatedSlideCount = (
        await Promise.all(
          pdfDecks.map(async (deck) => {
            const slides = await store.listSlidesByDeck(deck.id);
            return slides.filter((slide) => slide.annotated).length;
          }),
        )
      ).reduce((total, count) => total + count, 0);

      return {
        id: talk.id,
        conferenceId: talk.conferenceId,
        contributionId: talk.contributionId,
        sortStartsAt: talk.startsAt,
        dayLabel: formatAgendaDayLabel(talk.startsAt),
        title: talk.title,
        speaker: talk.speaker,
        sessionTitle: talk.sessionTitle,
        timeRangeLabel: formatAgendaTimeRange(talk.startsAt, talk.endsAt),
        room: talk.room,
        bookmarked: talk.bookmarked,
        ...(talk.upstreamStatus ? { upstreamStatus: talk.upstreamStatus } : {}),
        ...(talk.upstreamStatus
          ? {
              upstreamSummary:
                talk.upstreamStatus === 'missing'
                  ? 'Removed from Indico'
                  : 'Updated on Indico',
            }
          : {}),
        materialSummary: formatMaterialSummary(pdfDecks.length),
        materials: await Promise.all(
          decks.map(async (deck) => ({
            id: deck.id,
            title: deck.displayName,
            sourceUrl: deck.sourceUrl,
            mimeType: deck.mimeType,
            selected: deck.selected,
            ...(deck.upstreamStatus
              ? { upstreamStatus: deck.upstreamStatus }
              : {}),
            pageCount:
              deck.mimeType === 'application/pdf'
                ? (await store.listSlidesByDeck(deck.id)).length
                : null,
          })),
        ),
        annotatedSlideCount,
      } satisfies AgendaTalkSummary;
    }),
  );

  return summaries.sort((left, right) => {
    const leftStartsAt = left.sortStartsAt;
    const rightStartsAt = right.sortStartsAt;

    if (leftStartsAt !== rightStartsAt) {
      if (leftStartsAt === null) {
        return 1;
      }

      if (rightStartsAt === null) {
        return -1;
      }

      return leftStartsAt - rightStartsAt;
    }

    return left.title.localeCompare(right.title);
  });
};
