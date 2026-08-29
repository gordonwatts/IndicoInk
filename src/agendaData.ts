import type { PersistenceStore } from './persistenceStore';
import type { AgendaTalkSummary } from './shared/agenda';
import { formatAgendaDayLabel, formatAgendaTimeRange } from './agendaTime';
import { isPdfDeck, isSlideDeck } from './slideDeck';

const formatMaterialSummary = (slideDeckCount: number) => {
  if (slideDeckCount === 0) {
    return 'No slides';
  }

  if (slideDeckCount === 1) {
    return 'PDF';
  }

  return `${slideDeckCount} PDFs`;
};

export const buildAgendaTalkSummaries = async (
  store: PersistenceStore,
  conferenceId: string,
): Promise<AgendaTalkSummary[]> => {
  const [talks, conference, conferenceDecks, conferenceSlides] =
    await Promise.all([
      store.listTalksByConference(conferenceId),
      store.getConference(conferenceId),
      store.listDecksByConference(conferenceId),
      store.listSlidesByConference(conferenceId),
    ]);
  const eventTimeZone = conference?.timeZone ?? null;
  const eventTimeZoneForFormatting = eventTimeZone ?? 'UTC';
  const decksByTalk = new Map<string, typeof conferenceDecks>();
  const slidesByDeck = new Map<string, typeof conferenceSlides>();

  for (const deck of conferenceDecks) {
    const decks = decksByTalk.get(deck.talkId) ?? [];
    decks.push(deck);
    decksByTalk.set(deck.talkId, decks);
  }

  for (const slide of conferenceSlides) {
    const slides = slidesByDeck.get(slide.deckId) ?? [];
    slides.push(slide);
    slidesByDeck.set(slide.deckId, slides);
  }

  const summaries = talks.map((talk) => {
    const decks = decksByTalk.get(talk.id) ?? [];
    const pdfDecks = decks.filter(
      (deck) =>
        deck.kind !== 'notebook' &&
        isSlideDeck(deck.mimeType, deck.sourceUrl, deck.displayName),
    );
    const notebookDeck = decks.find((deck) => deck.kind === 'notebook');
    const annotatedNotePageCount = notebookDeck
      ? (slidesByDeck.get(notebookDeck.id) ?? []).filter(
          (slide) => slide.annotated,
        ).length
      : 0;

    const annotatedSlideCount = pdfDecks.reduce(
      (total, deck) =>
        total +
        (slidesByDeck.get(deck.id) ?? []).filter((slide) => slide.annotated)
          .length,
      0,
    );

    return {
      id: talk.id,
      conferenceId: talk.conferenceId,
      contributionId: talk.contributionId,
      contributionUrl: talk.contributionUrl,
      sortStartsAt: talk.startsAt,
      startsAt: talk.startsAt,
      endsAt: talk.endsAt,
      ...(eventTimeZone ? { eventTimeZone } : {}),
      dayLabel: formatAgendaDayLabel(talk.startsAt, eventTimeZoneForFormatting),
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
      materials: decks
        .filter((deck) => deck.kind !== 'notebook')
        .map((deck) => ({
          id: deck.id,
          title: deck.displayName,
          sourceUrl: deck.sourceUrl,
          mimeType: deck.mimeType,
          selected: deck.selected,
          ...(deck.upstreamStatus
            ? { upstreamStatus: deck.upstreamStatus }
            : {}),
          pageCount: isPdfDeck(deck.mimeType, deck.sourceUrl, deck.displayName)
            ? (slidesByDeck.get(deck.id) ?? []).length
            : null,
        })),
      annotatedSlideCount,
      annotatedNotePageCount,
    } satisfies AgendaTalkSummary;
  });

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
