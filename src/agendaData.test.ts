import { describe, expect, it, vi } from 'vitest';

import { buildAgendaTalkSummaries } from './agendaData';

describe('buildAgendaTalkSummaries', () => {
  it('includes stored PDF materials in the agenda summary', async () => {
    const store = {
      listTalksByConference: vi.fn().mockResolvedValue([
        {
          id: 'talk-1',
          conferenceId: 'conference-1',
          contributionId: '1001',
          contributionUrl: 'https://example.org/contribution/1001',
          title: 'Talk',
          speaker: 'Speaker',
          sessionTitle: 'Session',
          startsAt: null,
          endsAt: null,
          room: 'Room',
          bookmarked: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      getConference: vi.fn().mockResolvedValue({ timeZone: 'UTC' }),
      listDecksByConference: vi.fn().mockResolvedValue([
        {
          id: 'missing-unannotated',
          conferenceId: 'conference-1',
          talkId: 'talk-1',
          sourceUrl: 'https://example.org/missing.pdf',
          displayName: 'Removed deck',
          mimeType: 'application/pdf',
          selected: true,
          createdAt: 1,
          updatedAt: 1,
          upstreamStatus: 'missing',
        },
        {
          id: 'missing-annotated',
          conferenceId: 'conference-1',
          talkId: 'talk-1',
          sourceUrl: 'https://example.org/annotated.pdf',
          displayName: 'Annotated removed deck',
          mimeType: 'application/pdf',
          selected: false,
          createdAt: 1,
          updatedAt: 1,
          upstreamStatus: 'missing',
        },
        {
          id: 'new-deck',
          conferenceId: 'conference-1',
          talkId: 'talk-1',
          sourceUrl: 'https://example.org/new.pdf',
          displayName: 'New deck',
          mimeType: 'application/pdf',
          selected: false,
          createdAt: 1,
          updatedAt: 1,
          upstreamStatus: 'present',
        },
      ]),
      listSlidesByConference: vi.fn().mockResolvedValue([
        {
          id: 'slide-1',
          deckId: 'missing-annotated',
          slideNumber: 1,
          annotated: true,
        },
      ]),
      listAnnotationsBySlide: vi
        .fn()
        .mockImplementation(async (slideId: string) =>
          slideId === 'slide-1' ? [{ id: 'annotation-1' }] : [],
        ),
    };

    const [talk] = await buildAgendaTalkSummaries(
      store as never,
      'conference-1',
    );

    expect(talk?.materialSummary).toBe('3 PDFs');
    expect(talk?.materials.map((material) => material.id)).toEqual([
      'missing-unannotated',
      'missing-annotated',
      'new-deck',
    ]);
    expect(talk?.annotatedSlideCount).toBe(1);
    expect(
      talk?.materials.find(({ id }) => id === 'missing-annotated'),
    ).toMatchObject({ pageCount: 1 });
    expect(store.listDecksByConference).toHaveBeenCalledOnce();
    expect(store.listSlidesByConference).toHaveBeenCalledOnce();
  });
});
