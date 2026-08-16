import { describe, expect, it, vi } from 'vitest';

import type { AgendaImportData } from './agendaImportModel';
import { persistImportedAgenda } from './agendaImportPersistence';
import type { Deck } from './persistenceModels';
import type { PersistenceStore } from './persistenceStore';

describe('persistImportedAgenda', () => {
  it('selects the PDF when a talk imports both PDF and PowerPoint decks', async () => {
    const decks: Deck[] = [];
    const transactionStore = {
      upsertConference: vi.fn(),
      getTalk: vi.fn().mockResolvedValue(null),
      upsertTalk: vi.fn(),
      upsertDeck: vi.fn(async (deck: Deck) => {
        decks.push(deck);
      }),
    };
    const store = {
      transaction: async (
        work: (transaction: typeof transactionStore) => Promise<void>,
      ) => work(transactionStore),
    } as unknown as PersistenceStore;
    const mapped = {
      conference: {
        id: 'conference-1',
        sourceUrl: 'https://example.org/event/1',
        title: 'Mixed deck event',
        dates: 'June 12, 2026',
        host: 'example.org',
        sourceKind: 'indico' as const,
        timeZone: 'UTC',
        lastOpenedAt: null,
        createdAt: 0,
        updatedAt: 0,
      },
      hierarchy: [],
      talks: [
        {
          contributionId: 'talk-1',
          title: 'Talk with two formats',
          speaker: '',
          speakers: [],
          sessionTitle: 'Session',
          startsAt: null,
          endsAt: null,
          room: 'Room',
          contributionUrl: 'https://example.org/event/1/contributions/1',
          materials: [
            {
              id: 'ppt-material',
              contributionId: 'talk-1',
              title: 'PowerPoint slides',
              url: 'https://example.org/event/1/slides.pptx',
              mimeType:
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              selected: true,
              kind: 'pdf' as const,
            },
            {
              id: 'pdf-material',
              contributionId: 'talk-1',
              title: 'PDF slides',
              url: 'https://example.org/event/1/slides.pdf',
              mimeType: 'application/pdf',
              selected: false,
              kind: 'pdf' as const,
            },
          ],
          bookmarked: false,
          entryKind: 'talk' as const,
          linkedAgendaUrl: '',
        },
      ],
      speakers: [],
      materials: [],
    } satisfies AgendaImportData;

    await persistImportedAgenda(store, mapped);

    expect(decks).toHaveLength(2);
    expect(
      decks.find((deck) => deck.sourceUrl.endsWith('.pdf'))?.selected,
    ).toBe(true);
    expect(
      decks.find((deck) => deck.sourceUrl.endsWith('.pptx'))?.selected,
    ).toBe(false);
  });
});
