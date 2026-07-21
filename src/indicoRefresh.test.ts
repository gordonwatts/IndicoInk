import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createAnnotationId,
  createConferenceId,
  createDeckId,
  createSlideId,
  createTalkId,
} from './persistenceModels';
import { PersistenceStore } from './persistenceStore';
import { refreshIndicoEvent, resolveLinkedAgendaUrl } from './indicoRefresh';

const makeStore = () =>
  new PersistenceStore(
    join(mkdtempSync(join(tmpdir(), 'indicoink-refresh-')), 'db.sqlite3'),
  );

const buildRefreshEvent = () => ({
  results: [
    {
      title: 'Refreshed Indico Event',
      startDate: { date: '2026-06-12' },
      endDate: { date: '2026-06-13' },
      contributions: [
        {
          friendly_id: '1001',
          title: 'Updated talk title',
          startDate: { date: '2026-06-12', time: '09:00:00' },
          endDate: { date: '2026-06-12', time: '09:30:00' },
          room: 'Room 1',
          speakers: [{ fullName: 'Ada Lovelace' }],
          material: [
            {
              title: 'Slides v2',
              url: 'https://indico.example.org/event/refresh-2026/materials/slides.pdf',
              mimetype: 'application/pdf',
              selected: true,
            },
            {
              title: 'Extra appendix',
              url: 'https://indico.example.org/event/refresh-2026/materials/extras.pdf',
              mimetype: 'application/pdf',
              selected: false,
            },
          ],
        },
      ],
    },
  ],
});

describe('refreshIndicoEvent', () => {
  it('does not report a conflict when an annotated PDF keeps its URL but its label changes', async () => {
    const store = makeStore();
    const eventUrl = 'https://indico.example.org/event/refresh-2026';
    const conferenceId = createConferenceId(eventUrl);
    const talkId = createTalkId(conferenceId, '1001');
    const deckId = createDeckId(
      talkId,
      'https://indico.example.org/event/refresh-2026/materials/slides.pdf',
    );
    const slideId = createSlideId(deckId, 1);
    const now = 1_700_000_000_000;

    await store.upsertConference({
      id: conferenceId,
      sourceUrl: eventUrl,
      title: 'Original Indico Event',
      dates: 'June 12, 2026',
      host: 'indico.example.org',
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertTalk({
      id: talkId,
      conferenceId,
      contributionId: '1001',
      contributionUrl:
        'https://indico.example.org/event/refresh-2026/contributions/1001/',
      title: 'Original talk title',
      speaker: 'Ada Lovelace',
      sessionTitle: 'Session one',
      startsAt: now,
      endsAt: now + 1_800_000,
      room: 'Room 1',
      bookmarked: false,
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertDeck({
      id: deckId,
      conferenceId,
      talkId,
      sourceUrl:
        'https://indico.example.org/event/refresh-2026/materials/slides.pdf',
      displayName: 'Slides v1',
      mimeType: 'application/pdf',
      selected: true,
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertSlide({
      id: slideId,
      conferenceId,
      talkId,
      deckId,
      slideNumber: 1,
      annotated: true,
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertAnnotation({
      id: createAnnotationId(slideId, 1),
      conferenceId,
      talkId,
      deckId,
      slideId,
      points: [
        { x: 0.1, y: 0.2, pressure: 0.5, time: 1 },
        { x: 0.2, y: 0.3, pressure: 0.7, time: 2 },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const firstRefreshResult = await refreshIndicoEvent(store, eventUrl, {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: vi.fn().mockReturnValue(null) },
        text: vi.fn().mockResolvedValue(JSON.stringify(buildRefreshEvent())),
      }),
    });

    expect(firstRefreshResult).toMatchObject({
      kind: 'refreshed',
      conferenceId,
      title: 'Refreshed Indico Event',
      changedTalkCount: 1,
      newlyAvailableDeckCount: 1,
    });

    const refreshResult = await refreshIndicoEvent(store, eventUrl, {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: vi.fn().mockReturnValue(null) },
        text: vi.fn().mockResolvedValue(JSON.stringify(buildRefreshEvent())),
      }),
    });

    expect(refreshResult).toMatchObject({
      kind: 'refreshed',
      conferenceId,
      title: 'Refreshed Indico Event',
      changedTalkCount: 0,
      newlyAvailableDeckCount: 0,
    });

    const decks = await store.listDecksByTalk(talkId);
    expect(decks).toHaveLength(2);
    expect(decks.find((deck) => deck.id === deckId)?.displayName).toBe(
      'Slides v2',
    );
    expect(
      decks.find((deck) => deck.sourceUrl.endsWith('/materials/extras.pdf'))
        ?.displayName,
    ).toBe('Extra appendix');

    const talk = await store.getTalk(talkId);
    expect(talk?.title).toBe('Updated talk title');
    expect(talk?.upstreamStatus).toBe('present');

    await store.close();
  });
});

describe('resolveLinkedAgendaUrl', () => {
  it('resolves an existing session URL to its linked agenda attachment', async () => {
    const sessionUrl =
      'https://indico.example.org/event/current-meeting/sessions/42/';
    const linkedAgendaUrl =
      'https://indico.example.org/event/other-meeting/#day-2026-07-07';
    const response = await resolveLinkedAgendaUrl(
      'https://indico.example.org/event/current-meeting',
      sessionUrl,
      {
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: vi.fn().mockReturnValue(null) },
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              results: [
                {
                  title: 'Current meeting',
                  sessions: [
                    {
                      id: '42',
                      title: 'Linked session',
                      url: sessionUrl,
                      contributions: [],
                      session: {
                        folders: [
                          {
                            attachments: [{ link_url: linkedAgendaUrl }],
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            }),
          ),
        }),
      },
    );

    expect(response).toBe(linkedAgendaUrl);
  });
});
