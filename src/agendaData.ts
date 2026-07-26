import type { PersistenceStore } from './persistenceStore';
import type { AgendaTalkSummary } from './shared/agenda';
import { formatAgendaDayLabel, formatAgendaTimeRange } from './agendaTime';

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
  const conference = await store.getConference(conferenceId);
  const eventTimeZone = conference?.timeZone ?? null;
  const eventTimeZoneForFormatting = eventTimeZone ?? 'UTC';

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
        contributionUrl: talk.contributionUrl,
        sortStartsAt: talk.startsAt,
        startsAt: talk.startsAt,
        endsAt: talk.endsAt,
        ...(eventTimeZone ? { eventTimeZone } : {}),
        dayLabel: formatAgendaDayLabel(
          talk.startsAt,
          eventTimeZoneForFormatting,
        ),
        title: talk.title,
        speaker: talk.speaker,
        sessionTitle: talk.sessionTitle,
        timeRangeLabel: formatAgendaTimeRange(
          talk.startsAt,
          talk.endsAt,
          eventTimeZoneForFormatting,
        ),
        room: talk.room,
        bookmarked: talk.bookmarked,
        ...(talk.upstreamStatus ? { upstreamStatus: talk.upstreamStatus } : {}),
        entryKind: talk.entryKind ?? 'talk',
        linkedAgendaUrl: talk.linkedAgendaUrl ?? '',
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
