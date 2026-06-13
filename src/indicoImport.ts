import type { PersistenceStore } from './persistenceStore';
import { createDeckId, createTalkId } from './persistenceModels';
import type { ImportedConferenceResult } from './shared/library';
import { parseIndicoEventUrl } from './indicoEvent';
import { fetchIndicoJson, type FetchIndicoJsonOptions } from './indicoHttp';
import { mapIndicoExportEnvelope } from './indicoMapping';

export type ImportIndicoEventOptions = FetchIndicoJsonOptions;

export class IndicoEventImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndicoEventImportError';
  }
}

export const importIndicoEvent = async (
  store: PersistenceStore,
  eventUrl: string,
  options: ImportIndicoEventOptions = {},
): Promise<ImportedConferenceResult> => {
  const identity = parseIndicoEventUrl(eventUrl);
  if (!identity) {
    throw new IndicoEventImportError(
      'The provided URL is not a valid Indico event.',
    );
  }

  const raw = await fetchIndicoJson<unknown>(identity, options);
  const mapped = mapIndicoExportEnvelope(
    raw as { results?: unknown },
    identity,
  );
  const now = Date.now();
  let deckCount = 0;

  await store.transaction(async (transactionStore) => {
    await transactionStore.upsertConference({
      ...mapped.conference,
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    for (const talk of mapped.talks) {
      const talkId = createTalkId(identity.conferenceId, talk.contributionId);
      const existingTalk = await transactionStore.getTalk(talkId);
      await transactionStore.upsertTalk({
        id: talkId,
        conferenceId: identity.conferenceId,
        contributionId: talk.contributionId,
        contributionUrl: talk.contributionUrl,
        title: talk.title,
        speaker: talk.speaker,
        sessionTitle: talk.sessionTitle,
        startsAt: talk.startsAt,
        endsAt: talk.endsAt,
        room: talk.room,
        bookmarked: existingTalk?.bookmarked ?? talk.bookmarked,
        createdAt: now,
        updatedAt: now,
      });

      const pdfMaterials = talk.materials.filter(
        (material) => material.kind === 'pdf',
      );
      const selectedMaterial =
        pdfMaterials.find((material) => material.selected) ??
        pdfMaterials[0] ??
        null;

      for (const material of pdfMaterials) {
        deckCount += 1;
        await transactionStore.upsertDeck({
          id: createDeckId(talkId, material.url),
          conferenceId: identity.conferenceId,
          talkId,
          sourceUrl: material.url,
          displayName: material.title,
          mimeType: material.mimeType,
          selected: selectedMaterial
            ? material.url === selectedMaterial.url
            : false,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  });

  return {
    conferenceId: identity.conferenceId,
    title: mapped.conference.title,
    talkCount: mapped.talks.length,
    deckCount,
    savedAt: now,
  };
};
