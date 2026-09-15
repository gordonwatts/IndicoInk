import { describe, expect, it } from 'vitest';

import { parseIndicoEventUrl } from './indicoEvent';
import { mapIndicoExportEnvelope } from './indicoMapping';

const identity = parseIndicoEventUrl('https://indico.global/event/18639')!;

describe('sub-contribution identity mapping', () => {
  it('uses globally unique database IDs for sub-contributions', () => {
    const mapped = mapIndicoExportEnvelope(
      {
        results: [
          {
            title: 'Workshop with nested contributions',
            startDate: { date: '2026-09-14', time: '09:00:00', tz: 'UTC' },
            endDate: { date: '2026-09-14', time: '10:00:00', tz: 'UTC' },
            contributions: [
              {
                _type: 'Contribution',
                id: '3',
                friendly_id: 3,
                title: 'Parent contribution',
                startDate: { date: '2026-09-14', time: '09:00:00', tz: 'UTC' },
                subContributions: [
                  {
                    _type: 'SubContribution',
                    id: '9',
                    friendly_id: 9,
                    db_id: 1840,
                    title: 'Nested talk one',
                  },
                  {
                    _type: 'SubContribution',
                    id: '10',
                    friendly_id: 10,
                    db_id: 1841,
                    title: 'Nested talk two',
                  },
                ],
              },
              {
                _type: 'Contribution',
                id: '9',
                friendly_id: 9,
                title: 'Sibling parent with reused friendly ID',
                startDate: { date: '2026-09-14', time: '09:30:00', tz: 'UTC' },
              },
            ],
          },
        ],
      },
      identity,
    );

    expect(mapped.talks.map((talk) => talk.contributionId)).toEqual([
      '3',
      '1840',
      '1841',
      '9',
    ]);
    expect(new Set(mapped.talks.map((talk) => talk.contributionId)).size).toBe(
      mapped.talks.length,
    );
    expect(mapped.hierarchy[0]?.sessions[0]?.contributionIds).toEqual([
      '3',
      '9',
    ]);
  });
});
