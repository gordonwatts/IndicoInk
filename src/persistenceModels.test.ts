import { describe, expect, it } from 'vitest';

import {
  countAnnotatedSlides,
  countAnnotations,
  createConferenceId,
  createDeckId,
  createSlideId,
  createTalkId,
  type Annotation,
} from './persistenceModels';

describe('persistence models', () => {
  it('creates stable ids from the same source data', () => {
    const conferenceId = createConferenceId('https://example.org/event');
    expect(conferenceId).toBe(createConferenceId('https://example.org/event'));

    const talkId = createTalkId(conferenceId, 'contribution-42');
    expect(talkId).toBe(createTalkId(conferenceId, 'contribution-42'));

    const deckId = createDeckId(talkId, 'https://example.org/slides.pdf');
    expect(deckId).toBe(createDeckId(talkId, 'https://example.org/slides.pdf'));

    const slideId = createSlideId(deckId, 7);
    expect(slideId).toBe(createSlideId(deckId, 7));
  });

  it('counts annotated slides and annotations', () => {
    expect(
      countAnnotatedSlides([
        {
          id: 'slide-1',
          conferenceId: 'conference-1',
          talkId: 'talk-1',
          deckId: 'deck-1',
          slideNumber: 1,
          annotated: true,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'slide-2',
          conferenceId: 'conference-1',
          talkId: 'talk-1',
          deckId: 'deck-1',
          slideNumber: 2,
          annotated: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ).toBe(1);

    const annotations = [
      {
        id: 'stroke-1',
        conferenceId: 'conference-1',
        talkId: 'talk-1',
        deckId: 'deck-1',
        slideId: 'slide-1',
        points: [{ x: 0.1, y: 0.2, pressure: 0.4, time: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'note-1',
        conferenceId: 'conference-1',
        talkId: 'talk-1',
        deckId: 'deck-1',
        slideId: 'slide-1',
        x: 0.2,
        y: 0.4,
        text: 'note',
        createdAt: 1,
        updatedAt: 1,
      },
    ] satisfies Annotation[];

    expect(countAnnotations(annotations)).toBe(2);
  });
});
