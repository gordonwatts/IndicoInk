import {
  createAnnotationId,
  createConferenceId,
  createDeckId,
  createSlideId,
  createTalkId,
  createViewStateId,
  type Conference,
  type Deck,
  type Slide,
  type Talk,
} from './persistenceModels';
import {
  conferenceFixtures,
  type ConferenceFixture,
  type MaterialFixture,
  validateConferenceFixture,
} from './conferenceFixtures';
import type { PersistenceStore } from './persistenceStore';
import type {
  ImportedConferenceResult,
  LibraryEventSummary,
} from './shared/library';

const minimumVisibleAnnotationCount = 1;
const dayLabelPattern = /^([A-Za-z]+),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/;
const monthLookup: Record<string, number> = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

const parseTime = (value: string) => {
  const [hoursText, minutesText] = value.split(':');
  return {
    hours: Number(hoursText),
    minutes: Number(minutesText),
  };
};

const toUtcTimestamp = (dayLabel: string, time: string) => {
  const match = dayLabel.match(dayLabelPattern);
  if (!match) {
    return null;
  }

  const monthName = match[2];
  const dayText = match[3];
  const yearText = match[4];
  if (!monthName || !dayText || !yearText) {
    return null;
  }

  const month = monthLookup[monthName];
  if (month === undefined) {
    return null;
  }

  const { hours, minutes } = parseTime(time);
  return Date.UTC(
    Number(yearText),
    month,
    Number(dayText),
    hours,
    minutes,
    0,
    0,
  );
};

const formatLastOpened = (lastOpenedAt: number | null, now: number) => {
  if (lastOpenedAt === null) {
    return 'Not opened yet';
  }

  const ageMinutes = Math.max(0, Math.round((now - lastOpenedAt) / 60_000));
  if (ageMinutes < 1) {
    return 'Opened just now';
  }

  if (ageMinutes < 60) {
    return `Opened ${ageMinutes} minute${ageMinutes === 1 ? '' : 's'} ago`;
  }

  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 24) {
    return `Opened ${ageHours} hour${ageHours === 1 ? '' : 's'} ago`;
  }

  const ageDays = Math.round(ageHours / 24);
  return `Opened ${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
};

const getAnnotationCount = async (store: PersistenceStore, talkId: string) => {
  const count = await store.countAnnotatedSlidesByTalk(talkId);
  return count < minimumVisibleAnnotationCount ? 0 : count;
};

export const buildLibraryEventSummaries = async (
  store: PersistenceStore,
  now = Date.now(),
): Promise<LibraryEventSummary[]> => {
  const conferences = await store.listConferences();

  return Promise.all(
    conferences.map(async (conference) => {
      const talks = await store.listTalksByConference(conference.id);
      const annotationCount = (
        await Promise.all(
          talks.map((talk) => getAnnotationCount(store, talk.id)),
        )
      ).reduce((total, count) => total + count, 0);
      const deckCount = (
        await Promise.all(
          talks.map(
            async (talk) => (await store.listDecksByTalk(talk.id)).length,
          ),
        )
      ).reduce((total, count) => total + count, 0);

      return {
        id: conference.id,
        sourceUrl: conference.sourceUrl,
        title: conference.title,
        dates: conference.dates,
        host: conference.host,
        lastOpened: formatLastOpened(conference.lastOpenedAt, now),
        annotationSummary: `${annotationCount} annotated slide${
          annotationCount === 1 ? '' : 's'
        }`,
        cacheStatus: deckCount > 0 ? 'Cached for offline use' : 'Online only',
      } satisfies LibraryEventSummary;
    }),
  );
};

const getSelectedDeck = (materials: ReadonlyArray<MaterialFixture>) =>
  materials.find((material) => material.kind === 'pdf' && material.selected) ??
  materials.find((material) => material.kind === 'pdf');

export const importConferenceFixture = async (
  store: PersistenceStore,
  fixture: ConferenceFixture,
  now = Date.now(),
): Promise<ImportedConferenceResult> => {
  validateConferenceFixture(fixture);

  const conferenceId = createConferenceId(fixture.sourceUrl);
  let talkCount = 0;
  let deckCount = 0;

  await store.transaction(async (transactionStore) => {
    await transactionStore.upsertConference({
      id: conferenceId,
      sourceUrl: fixture.sourceUrl,
      title: fixture.title,
      dates: fixture.dates,
      host: fixture.host,
      lastOpenedAt: fixture.lastOpenedAt,
      createdAt: now,
      updatedAt: now,
    } satisfies Conference);

    for (let dayIndex = 0; dayIndex < fixture.days.length; dayIndex += 1) {
      const day = fixture.days[dayIndex]!;
      for (const session of day.sessions) {
        for (const talk of session.talks) {
          talkCount += 1;
          const talkId = createTalkId(conferenceId, talk.contributionId);
          await transactionStore.upsertTalk({
            id: talkId,
            conferenceId,
            contributionId: talk.contributionId,
            title: talk.title,
            speaker: talk.speaker,
            sessionTitle: session.title,
            startsAt: toUtcTimestamp(day.label, talk.startsAt),
            endsAt: toUtcTimestamp(day.label, talk.endsAt),
            room: talk.room,
            bookmarked: Boolean(talk.bookmarked),
            createdAt: now,
            updatedAt: now,
          } satisfies Talk);

          const pdfMaterials = talk.materials.filter(
            (material): material is Extract<MaterialFixture, { kind: 'pdf' }> =>
              material.kind === 'pdf',
          );
          const selectedMaterial =
            getSelectedDeck(talk.materials) ?? pdfMaterials[0] ?? null;

          for (const material of pdfMaterials) {
            deckCount += 1;
            const deckId = createDeckId(talkId, material.sourceUrl);
            const selected = selectedMaterial
              ? material.sourceUrl === selectedMaterial.sourceUrl
              : false;

            await transactionStore.upsertDeck({
              id: deckId,
              conferenceId,
              talkId,
              sourceUrl: material.sourceUrl,
              displayName: material.displayName,
              mimeType: 'application/pdf',
              selected,
              createdAt: now,
              updatedAt: now,
            } satisfies Deck);

            for (let page = 1; page <= material.pageCount; page += 1) {
              const slideId = createSlideId(deckId, page);
              const annotated = (material.annotatedSlides ?? []).includes(page);
              await transactionStore.upsertSlide({
                id: slideId,
                conferenceId,
                talkId,
                deckId,
                slideNumber: page,
                annotated,
                createdAt: now,
                updatedAt: now,
              } satisfies Slide);

              if (annotated) {
                await transactionStore.upsertAnnotation({
                  id: createAnnotationId(slideId, 1),
                  conferenceId,
                  talkId,
                  deckId,
                  slideId,
                  points: [
                    { x: 0.15, y: 0.2, pressure: 0.4, time: 1 },
                    { x: 0.35, y: 0.45, pressure: 0.7, time: 2 },
                  ],
                  createdAt: now,
                  updatedAt: now,
                });
              }
            }
          }
        }
      }
    }

    const firstSelectedDeck =
      fixture.days
        .flatMap((day) => day.sessions)
        .flatMap((session) => session.talks)
        .flatMap((talk) =>
          talk.materials.filter((material) => material.kind === 'pdf'),
        )
        .find((material) => material.selected) ??
      fixture.days
        .flatMap((day) => day.sessions)
        .flatMap((session) => session.talks)
        .flatMap((talk) =>
          talk.materials.filter((material) => material.kind === 'pdf'),
        )[0] ??
      null;

    if (firstSelectedDeck) {
      const selectedTalk = fixture.days
        .flatMap((day) =>
          day.sessions.flatMap((session) =>
            session.talks.map((talk) => ({ day, session, talk })),
          ),
        )
        .find((entry) =>
          entry.talk.materials.some(
            (material) =>
              material.kind === 'pdf' &&
              material.sourceUrl === firstSelectedDeck.sourceUrl,
          ),
        );

      if (selectedTalk) {
        const talkId = createTalkId(
          conferenceId,
          selectedTalk.talk.contributionId,
        );
        const deckId = createDeckId(talkId, firstSelectedDeck.sourceUrl);
        const slideId = createSlideId(deckId, 1);
        await transactionStore.upsertViewState({
          id: createViewStateId(deckId),
          conferenceId,
          talkId,
          deckId,
          slideId,
          currentSlideNumber: 1,
          zoom: 1,
          scrollLeft: 0,
          scrollTop: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  });

  return {
    conferenceId,
    title: fixture.title,
    talkCount,
    deckCount,
    savedAt: now,
  };
};

export const importConferenceFixtureByName = async (
  store: PersistenceStore,
  fixtureName: keyof typeof conferenceFixtures,
  now = Date.now(),
) => importConferenceFixture(store, conferenceFixtures[fixtureName], now);
