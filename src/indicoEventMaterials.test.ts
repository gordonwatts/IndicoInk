import { describe, expect, it, vi } from 'vitest';

import type { AgendaImportData } from './agendaImportModel';
import { mapIndicoExportEnvelope } from './indicoMapping';
import { parseIndicoEventUrl } from './indicoEvent';
import { persistImportedAgenda } from './agendaImportPersistence';
import type { Deck } from './persistenceModels';
import type { PersistenceStore } from './persistenceStore';

const identity = parseIndicoEventUrl('https://indico.example.org/event/153');
if (!identity) {
  throw new Error('Expected the synthetic Indico event URL to parse.');
}

describe('Indico event and session materials', () => {
  it('includes session and conference attachments for each session talk', () => {
    const mapped = mapIndicoExportEnvelope(
      {
        results: [
          {
            title: 'Materials event',
            material: [
              {
                title: 'Conference handbook',
                url: 'https://indico.example.org/materials/handbook.pdf',
                mimetype: 'application/pdf',
              },
            ],
            folders: [
              {
                attachments: [
                  {
                    title: 'Conference map',
                    download_url:
                      'https://indico.example.org/materials/map.png',
                    content_type: 'image/png',
                  },
                ],
              },
            ],
            sessions: [
              {
                id: 'session-153',
                title: 'Shared session',
                material: [
                  {
                    title: 'Session handout',
                    url: 'https://indico.example.org/materials/handout.pdf',
                    mimetype: 'application/pdf',
                  },
                ],
                contributions: [
                  {
                    id: 'talk-1',
                    title: 'First talk',
                    material: [
                      {
                        title: 'Talk slides',
                        url: 'https://indico.example.org/materials/talk-1.pdf',
                        mimetype: 'application/pdf',
                      },
                    ],
                  },
                  { id: 'talk-2', title: 'Second talk' },
                ],
              },
            ],
          },
        ],
      },
      identity,
    );

    expect(mapped.talks).toHaveLength(2);
    expect(
      mapped.talks[0]?.materials.map((material) => material.title),
    ).toEqual([
      'Talk slides',
      'Session handout',
      'Conference handbook',
      'Conference map',
    ]);
    expect(
      mapped.talks[1]?.materials.map((material) => material.title),
    ).toEqual(['Session handout', 'Conference handbook', 'Conference map']);
    expect(mapped.talks[1]?.materials.at(-1)?.kind).toBe('other');
  });

  it('persists non-PDF attachments without treating them as slide decks', async () => {
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
        id: 'conference-153',
        sourceUrl: 'https://indico.example.org/event/153',
        title: 'Materials event',
        dates: 'Date unavailable',
        host: 'indico.example.org',
        sourceKind: 'indico' as const,
        timeZone: 'UTC',
        lastOpenedAt: null,
        createdAt: 0,
        updatedAt: 0,
      },
      hierarchy: [],
      talks: [
        {
          contributionId: 'talk-153',
          title: 'Talk',
          speaker: '',
          speakers: [],
          sessionTitle: 'Session',
          startsAt: null,
          endsAt: null,
          room: 'Room',
          contributionUrl: 'https://indico.example.org/event/153/talk',
          materials: [
            {
              id: 'pdf',
              contributionId: 'talk-153',
              title: 'Slides',
              url: 'https://indico.example.org/materials/slides.pdf',
              mimeType: 'application/pdf',
              selected: true,
              kind: 'pdf' as const,
            },
            {
              id: 'map',
              contributionId: 'talk-153',
              title: 'Map',
              url: 'https://indico.example.org/materials/map.png',
              mimeType: 'image/png',
              selected: false,
              kind: 'other' as const,
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

    const result = await persistImportedAgenda(store, mapped);

    expect(result.deckCount).toBe(1);
    expect(decks).toHaveLength(2);
    expect(decks.find((deck) => deck.displayName === 'Map')).toMatchObject({
      kind: 'other',
      selected: false,
    });
  });
});
