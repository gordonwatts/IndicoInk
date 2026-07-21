import type { PersistenceStore } from './persistenceStore';
import {
  createDeckId,
  createTalkId,
  type Deck,
  type Talk,
} from './persistenceModels';
import { parseIndicoEventUrl } from './indicoEvent';
import {
  fetchIndicoJson,
  IndicoHttpError,
  type FetchIndicoJsonOptions,
} from './indicoHttp';
import {
  isEmptyIndicoExportEnvelope,
  mapIndicoExportEnvelope,
} from './indicoMapping';
import type {
  RefreshConflict,
  RefreshLibraryEventResult,
} from './shared/library';

type RefreshDecision = 'keep' | 'replace';

const getConferenceDecksByTalk = async (
  store: PersistenceStore,
  talkId: string,
) => {
  const decks = await store.listDecksByTalk(talkId);
  return decks.filter((deck) => deck.mimeType === 'application/pdf');
};

const compareTalk = (current: Talk, next: Talk) =>
  current.title !== next.title ||
  current.speaker !== next.speaker ||
  current.sessionTitle !== next.sessionTitle ||
  current.startsAt !== next.startsAt ||
  current.endsAt !== next.endsAt ||
  current.room !== next.room ||
  current.contributionUrl !== next.contributionUrl;

const compareDeck = (current: Deck, next: Deck) =>
  current.displayName !== next.displayName ||
  current.mimeType !== next.mimeType ||
  current.selected !== next.selected ||
  current.sourceUrl !== next.sourceUrl;

// A material's title and selected state are agenda metadata. They can change
// shape between equivalent Indico exports without changing the cached PDF.
// Only fields that identify the downloaded bytes may trigger an annotation
// conflict during refresh.
const compareDeckContent = (current: Deck, next: Deck) =>
  current.sourceUrl !== next.sourceUrl || current.mimeType !== next.mimeType;

const getDeckAnnotationCount = async (
  store: PersistenceStore,
  deckId: string,
) => {
  const slides = await store.listSlidesByDeck(deckId);
  const annotationCounts = await Promise.all(
    slides.map(
      async (slide) => (await store.listAnnotationsBySlide(slide.id)).length,
    ),
  );

  return annotationCounts.reduce((total, count) => total + count, 0);
};

const normalizeUrlForComparison = (value: string) => {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return value.trim().replace(/\/+$/, '');
  }
};

const buildConflict = (
  talkId: string,
  contributionId: string,
  talkTitle: string,
  selectedDeckId: string | null,
  selectedDeckTitle: string | null,
): RefreshConflict => ({
  talkId,
  contributionId,
  talkTitle,
  selectedDeckId,
  selectedDeckTitle,
  message:
    'The selected PDF changed upstream while this deck already has annotations.',
});

export const fetchMappedIndicoEvent = async (
  eventUrl: string,
  options: FetchIndicoJsonOptions = {},
) => {
  const identity = parseIndicoEventUrl(eventUrl);
  if (!identity) {
    throw new Error('The provided URL is not a valid Indico event.');
  }

  const raw = await fetchIndicoJson<unknown>(identity, options);
  if (
    isEmptyIndicoExportEnvelope(raw as { count?: unknown; results?: unknown })
  ) {
    throw new IndicoHttpError(
      `Indico returned no event data for ${identity.canonicalEventUrl}.`,
      403,
      'Indico returned no event data. This event may require an API key.',
    );
  }

  const mapped = mapIndicoExportEnvelope(
    raw as { results?: unknown },
    identity,
  );

  return { identity, mapped };
};

export const resolveLinkedAgendaUrl = async (
  eventUrl: string,
  sessionUrl: string,
  options: FetchIndicoJsonOptions = {},
) => {
  const { mapped } = await fetchMappedIndicoEvent(eventUrl, options);
  const normalizedSessionUrl = normalizeUrlForComparison(sessionUrl);
  return (
    mapped.talks.find(
      (talk) =>
        talk.entryKind === 'linked-agenda' &&
        normalizeUrlForComparison(talk.contributionUrl) ===
          normalizedSessionUrl,
    )?.linkedAgendaUrl ?? null
  );
};

export const refreshIndicoEvent = async (
  store: PersistenceStore,
  eventUrl: string,
  options: FetchIndicoJsonOptions & { decision?: RefreshDecision } = {},
): Promise<RefreshLibraryEventResult> => {
  const { identity, mapped } = await fetchMappedIndicoEvent(eventUrl, options);
  const conferenceId = identity.conferenceId;
  const currentConference = await store.getConference(conferenceId);
  if (!currentConference) {
    throw new Error('The requested conference does not exist locally.');
  }

  const currentTalks = await store.listTalksByConference(conferenceId);
  const currentTalkByContributionId = new Map(
    currentTalks.map((talk) => [talk.contributionId, talk] as const),
  );
  const incomingTalkByContributionId = new Map(
    mapped.talks.map((talk) => [talk.contributionId, talk] as const),
  );

  const conflicts: RefreshConflict[] = [];
  let changedTalkCount = 0;
  let removedTalkCount = 0;
  let newlyAvailableDeckCount = 0;
  let deckCount = 0;

  for (const currentTalk of currentTalks) {
    const incomingTalk = incomingTalkByContributionId.get(
      currentTalk.contributionId,
    );

    if (!incomingTalk) {
      removedTalkCount += 1;
      continue;
    }

    const currentDecks = await getConferenceDecksByTalk(store, currentTalk.id);
    const incomingDecks = incomingTalk.materials.filter(
      (material) => material.kind === 'pdf',
    );
    const incomingDeckBySourceUrl = new Map(
      incomingDecks.map((material) => [material.url, material] as const),
    );

    const nextTalkForComparison: Talk = {
      id: currentTalk.id,
      conferenceId,
      contributionId: currentTalk.contributionId,
      contributionUrl: incomingTalk.contributionUrl,
      entryKind: incomingTalk.entryKind ?? 'talk',
      linkedAgendaUrl: incomingTalk.linkedAgendaUrl ?? '',
      title: incomingTalk.title,
      speaker: incomingTalk.speaker,
      sessionTitle: incomingTalk.sessionTitle,
      startsAt: incomingTalk.startsAt,
      endsAt: incomingTalk.endsAt,
      room: incomingTalk.room,
      bookmarked: currentTalk.bookmarked,
      createdAt: currentTalk.createdAt,
      updatedAt: currentTalk.updatedAt,
    };

    if (compareTalk(currentTalk, nextTalkForComparison)) {
      changedTalkCount += 1;
    }

    for (const currentDeck of currentDecks) {
      const incomingDeck = incomingDeckBySourceUrl.get(currentDeck.sourceUrl);
      if (!incomingDeck) {
        continue;
      }

      const nextDeck: Deck = {
        id: currentDeck.id,
        conferenceId,
        talkId: currentTalk.id,
        sourceUrl: incomingDeck.url,
        displayName: incomingDeck.title,
        mimeType: incomingDeck.mimeType,
        selected: incomingDeck.selected,
        createdAt: currentDeck.createdAt,
        updatedAt: currentDeck.updatedAt,
        upstreamStatus: 'present',
      };

      const deckHasAnnotations =
        (await getDeckAnnotationCount(store, currentDeck.id)) > 0;
      if (
        deckHasAnnotations &&
        compareDeckContent(currentDeck, nextDeck) &&
        options.decision !== 'replace'
      ) {
        conflicts.push(
          buildConflict(
            currentTalk.id,
            currentTalk.contributionId,
            currentTalk.title,
            currentDeck.id,
            currentDeck.displayName,
          ),
        );
      }
    }
  }

  if (conflicts.length > 0 && options.decision === undefined) {
    return {
      kind: 'conflict',
      conferenceId,
      title: mapped.conference.title,
      conflicts,
    };
  }

  await store.transaction(async (transactionStore) => {
    await transactionStore.upsertConference({
      ...mapped.conference,
      lastOpenedAt: Date.now(),
      createdAt: currentConference.createdAt,
      updatedAt: Date.now(),
    });

    for (const incomingTalk of mapped.talks) {
      const currentTalk = currentTalkByContributionId.get(
        incomingTalk.contributionId,
      );
      const talkId = createTalkId(conferenceId, incomingTalk.contributionId);
      const upstreamStatus = currentTalk
        ? compareTalk(currentTalk, {
            id: currentTalk.id,
            conferenceId,
            contributionId: currentTalk.contributionId,
            contributionUrl: incomingTalk.contributionUrl,
            entryKind: incomingTalk.entryKind ?? 'talk',
            linkedAgendaUrl: incomingTalk.linkedAgendaUrl ?? '',
            title: incomingTalk.title,
            speaker: incomingTalk.speaker,
            sessionTitle: incomingTalk.sessionTitle,
            startsAt: incomingTalk.startsAt,
            endsAt: incomingTalk.endsAt,
            room: incomingTalk.room,
            bookmarked: currentTalk.bookmarked,
            createdAt: currentTalk.createdAt,
            updatedAt: currentTalk.updatedAt,
          })
          ? 'changed'
          : 'present'
        : 'present';

      await transactionStore.upsertTalk({
        id: talkId,
        conferenceId,
        contributionId: incomingTalk.contributionId,
        contributionUrl: incomingTalk.contributionUrl,
        title: incomingTalk.title,
        speaker: incomingTalk.speaker,
        sessionTitle: incomingTalk.sessionTitle,
        startsAt: incomingTalk.startsAt,
        endsAt: incomingTalk.endsAt,
        room: incomingTalk.room,
        bookmarked: currentTalk?.bookmarked ?? incomingTalk.bookmarked,
        createdAt: currentTalk?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        upstreamStatus,
        entryKind: incomingTalk.entryKind ?? 'talk',
        linkedAgendaUrl: incomingTalk.linkedAgendaUrl ?? '',
      });

      const currentDecks = await getConferenceDecksByTalk(
        transactionStore,
        talkId,
      );
      const currentDeckBySourceUrl = new Map(
        currentDecks.map((deck) => [deck.sourceUrl, deck] as const),
      );

      for (const incomingMaterial of incomingTalk.materials.filter(
        (material) => material.kind === 'pdf',
      )) {
        const currentDeck = currentDeckBySourceUrl.get(incomingMaterial.url);
        const deckId = createDeckId(talkId, incomingMaterial.url);
        const nextDeck: Deck = {
          id: deckId,
          conferenceId,
          talkId,
          sourceUrl: incomingMaterial.url,
          displayName: incomingMaterial.title,
          mimeType: incomingMaterial.mimeType,
          selected: incomingMaterial.selected,
          createdAt: currentDeck?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          upstreamStatus: currentDeck
            ? compareDeck(currentDeck, {
                id: deckId,
                conferenceId,
                talkId,
                sourceUrl: incomingMaterial.url,
                displayName: incomingMaterial.title,
                mimeType: incomingMaterial.mimeType,
                selected: incomingMaterial.selected,
                createdAt: currentDeck.createdAt,
                updatedAt: currentDeck.updatedAt,
              })
              ? 'changed'
              : 'present'
            : 'present',
        };

        if (!currentDeck) {
          newlyAvailableDeckCount += 1;
        }

        const deckHasAnnotations = currentDeck
          ? (await getDeckAnnotationCount(transactionStore, currentDeck.id)) > 0
          : false;
        const deckNeedsKeep =
          currentDeck !== undefined &&
          deckHasAnnotations &&
          compareDeckContent(currentDeck, nextDeck) &&
          options.decision === 'keep';

        if (deckNeedsKeep && currentDeck) {
          await transactionStore.upsertDeck({
            ...currentDeck,
            upstreamStatus: 'changed',
            updatedAt: Date.now(),
          });
          continue;
        }

        await transactionStore.upsertDeck(nextDeck);
        deckCount += 1;
      }

      for (const currentDeck of currentDecks) {
        if (
          incomingTalk.materials.some(
            (material) =>
              material.kind === 'pdf' && material.url === currentDeck.sourceUrl,
          )
        ) {
          continue;
        }

        await transactionStore.upsertDeck({
          ...currentDeck,
          upstreamStatus: 'missing',
          updatedAt: Date.now(),
        });
      }
    }

    for (const currentTalk of currentTalks) {
      if (incomingTalkByContributionId.has(currentTalk.contributionId)) {
        continue;
      }

      await transactionStore.upsertTalk({
        ...currentTalk,
        upstreamStatus: 'missing',
        updatedAt: Date.now(),
      });
    }
  });

  return {
    kind: 'refreshed',
    conferenceId,
    title: mapped.conference.title,
    talkCount: mapped.talks.length,
    deckCount,
    changedTalkCount,
    removedTalkCount,
    newlyAvailableDeckCount,
  };
};
