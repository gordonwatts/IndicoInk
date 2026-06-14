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
import { refreshIndicoEvent } from './indicoRefresh';

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
  it('detects annotated deck conflicts, keeps the old cache when requested, and imports new PDFs', async () => {
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

    const conflictResult = await refreshIndicoEvent(store, eventUrl, {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: vi.fn().mockReturnValue(null) },
        text: vi.fn().mockResolvedValue(JSON.stringify(buildRefreshEvent())),
      }),
    });

    expect(conflictResult).toMatchObject({
      kind: 'conflict',
      conferenceId,
      title: 'Refreshed Indico Event',
    });
    if (conflictResult.kind === 'conflict') {
      expect(conflictResult.conflicts).toHaveLength(1);
    }

    const keepResult = await refreshIndicoEvent(store, eventUrl, {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: vi.fn().mockReturnValue(null) },
        text: vi.fn().mockResolvedValue(JSON.stringify(buildRefreshEvent())),
      }),
      decision: 'keep',
    });

    expect(keepResult).toMatchObject({
      kind: 'refreshed',
      conferenceId,
      title: 'Refreshed Indico Event',
      changedTalkCount: 1,
      newlyAvailableDeckCount: 1,
    });

    const decks = await store.listDecksByTalk(talkId);
    expect(decks).toHaveLength(2);
    expect(decks.find((deck) => deck.id === deckId)?.displayName).toBe(
      'Slides v1',
    );
    expect(
      decks.find((deck) => deck.sourceUrl.endsWith('/materials/extras.pdf'))
        ?.displayName,
    ).toBe('Extra appendix');

    const talk = await store.getTalk(talkId);
    expect(talk?.title).toBe('Updated talk title');
    expect(talk?.upstreamStatus).toBe('changed');

    await store.close();
  });
});
