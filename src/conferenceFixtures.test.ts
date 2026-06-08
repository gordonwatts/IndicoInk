import { describe, expect, it } from 'vitest';

import {
  conferenceFixtures,
  type ConferenceFixture,
  countConferenceSessions,
  countConferenceTalks,
  validateConferenceFixture,
  validateConferenceFixtures,
} from './conferenceFixtures';

describe('conference fixtures', () => {
  it('validates the deterministic fixture set', () => {
    const results = validateConferenceFixtures([
      conferenceFixtures.small,
      conferenceFixtures.large,
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      dayCount: 1,
      contributionCount: 4,
      pdfMaterialCount: 4,
      nonPdfMaterialCount: 1,
      annotatedSlideCount: 6,
    });
    expect(results[1]).toMatchObject({
      dayCount: 3,
      contributionCount: 24,
      pdfMaterialCount: 24,
      nonPdfMaterialCount: 6,
      annotatedSlideCount: 32,
    });
  });

  it('exposes a small event and a large nested event with stable identity', () => {
    expect(conferenceFixtures.small.sourceUrl).toBe(
      'https://small.indico.example.org/event/indicoink-small-2026',
    );
    expect(conferenceFixtures.small.days).toHaveLength(1);
    expect(conferenceFixtures.small.days[0]?.sessions).toHaveLength(2);
    expect(conferenceFixtures.small.days[0]?.sessions[0]?.talks).toHaveLength(
      2,
    );

    expect(conferenceFixtures.large.sourceUrl).toBe(
      'https://symposium.indico.example.org/event/indicoink-2026',
    );
    expect(conferenceFixtures.large.days).toHaveLength(3);
    expect(countConferenceSessions(conferenceFixtures.large)).toBe(9);
    expect(countConferenceTalks(conferenceFixtures.large)).toBe(24);
  });

  it('rejects malformed fixture data', () => {
    const invalidFixture = JSON.parse(
      JSON.stringify(conferenceFixtures.small),
    ) as ConferenceFixture;

    invalidFixture.days[0]!.sessions[0]!.talks = [
      {
        ...invalidFixture.days[0]!.sessions[0]!.talks[0]!,
        contributionId: 'small-1002',
      },
      {
        ...invalidFixture.days[0]!.sessions[0]!.talks[1]!,
        contributionId: 'small-1002',
      },
    ];

    expect(() => validateConferenceFixture(invalidFixture)).toThrow(
      /Duplicate contribution ID/,
    );
  });
});
