import { describe, expect, it } from 'vitest';

import rawPublicEvent from '../tests/fixtures/indico/indico-event-40025.json';

import { parseIndicoEventUrl } from './indicoEvent';
import { mapIndicoExportEnvelope } from './indicoMapping';

const identity = parseIndicoEventUrl('https://indico.in2p3.fr/event/40025');

if (!identity) {
  throw new Error('Expected the public Indico event URL to parse.');
}

describe('mapIndicoExportEnvelope', () => {
  it('maps a public Indico export into conference and talk data', () => {
    const mapped = mapIndicoExportEnvelope(rawPublicEvent, identity);

    expect(mapped.conference.title).toBe('DIRAC Project meeting');
    expect(mapped.conference.sourceUrl).toBe(
      'https://indico.in2p3.fr/event/40025',
    );
    expect(mapped.talks).toHaveLength(5);
    expect(mapped.talks[0]?.contributionUrl).toBe(
      'https://indico.in2p3.fr/event/40025/contributions/174307/',
    );
    expect(mapped.talks[0]?.speakers[0]?.name).toBe('Tsaregorodtsev, Andrei');
    expect(mapped.talks[0]?.startsAt).toBe(
      Date.UTC(2026, 7 - 1, 7, 15, 25, 0, 0),
    );
  });

  it('keeps hierarchy and materials tolerant of missing or inconsistent fields', () => {
    const mapped = mapIndicoExportEnvelope(
      {
        results: [
          {
            id: '999',
            title: 'Synthetic event',
            startDate: { date: '2026-06-07', time: '09:00:00' },
            endDate: { date: '2026-06-07', time: '10:00:00' },
            contributions: [
              {
                id: '1',
                title: 'Unstructured talk',
                startDate: { date: '2026-06-07', time: '09:10:00' },
                session: { title: 'Session Alpha', room: 'A1' },
                material: [
                  {
                    title: 'Slides',
                    url: 'https://indico.example.org/materials/slides.pdf',
                    mimetype: 'application/pdf',
                  },
                  {
                    title: 'Broken material',
                  },
                ],
              },
            ],
            sessions: [
              {
                id: 'session-1',
                title: 'Session Alpha',
                startDate: { date: '2026-06-07', time: '09:00:00' },
                endDate: { date: '2026-06-07', time: '10:00:00' },
                room: 'A1',
                contributions: [],
              },
            ],
          },
        ],
      },
      identity,
    );

    expect(mapped.hierarchy).toHaveLength(1);
    expect(mapped.hierarchy[0]?.sessions[0]?.title).toBe('Session Alpha');
    expect(mapped.talks[0]?.speaker).toBe('');
    expect(mapped.talks[0]?.materials).toHaveLength(1);
    expect(mapped.materials[0]?.kind).toBe('pdf');
    expect(mapped.materials[0]?.url).toBe(
      'https://indico.example.org/materials/slides.pdf',
    );
  });

  it('reads PDF attachments from contribution folders', () => {
    const mapped = mapIndicoExportEnvelope(
      {
        results: [
          {
            id: '45230',
            title: 'Folder attachment event',
            startDate: { date: '2020-09-03', time: '08:30:00' },
            endDate: { date: '2020-09-03', time: '10:00:00' },
            contributions: [
              {
                id: '3',
                title: 'PDF lives in folder attachments',
                startDate: { date: '2020-09-03', time: '08:40:00' },
                endDate: { date: '2020-09-03', time: '08:50:00' },
                folders: [
                  {
                    attachments: [
                      {
                        title: 'Deck',
                        download_url:
                          'https://indico.example.org/event/45230/contributions/3/attachments/1/Deck.pdf',
                        content_type: 'application/pdf',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      identity,
    );

    expect(mapped.talks[0]?.materials).toHaveLength(1);
    expect(mapped.talks[0]?.materials[0]?.kind).toBe('pdf');
    expect(mapped.talks[0]?.materials[0]?.url).toContain('/Deck.pdf');
  });
});
