import type { AgendaImportData } from './agendaImportModel';
import type { PersistenceStore } from './persistenceStore';
import { createDeckId, createTalkId } from './persistenceModels';
import type { ImportedConferenceResult } from './shared/library';

export const persistImportedAgenda = async (
  store: PersistenceStore,
  mapped: AgendaImportData,
): Promise<ImportedConferenceResult> => {
  const now = Date.now();
  const conferenceId = mapped.conference.id;
  let deckCount = 0;

  await store.transaction(async (transactionStore) => {
    await transactionStore.upsertConference({
      ...mapped.conference,
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    for (const talk of mapped.talks) {
      const talkId = createTalkId(conferenceId, talk.contributionId);
      const existingTalk = await transactionStore.getTalk(talkId);
      await transactionStore.upsertTalk({
        id: talkId,
        conferenceId,
        contributionId: talk.contributionId,
        contributionUrl: talk.contributionUrl,
        title: talk.title,
        speaker: talk.speaker,
        sessionTitle: talk.sessionTitle,
        startsAt: talk.startsAt,
        endsAt: talk.endsAt,
        room: talk.room,
        bookmarked: existingTalk?.bookmarked ?? talk.bookmarked,
        entryKind: talk.entryKind ?? 'talk',
        linkedAgendaUrl: talk.linkedAgendaUrl ?? '',
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
          conferenceId,
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
    conferenceId,
    title: mapped.conference.title,
    talkCount: mapped.talks.length,
    deckCount,
    savedAt: now,
  };
};
