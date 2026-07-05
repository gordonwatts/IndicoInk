import { describe, expect, it, vi } from 'vitest';

import {
  buildConferenceNotesMarkdown,
  renderAnnotatedSlidePng,
} from './exportNotes';
import type { ConferenceExportSnapshot } from './shared/exportNotes';

const formatLocalDateTimeForTest = (value: number) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(new Date(value));

  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${getPart('year')}-${getPart('month')}-${getPart('day')} ${getPart('hour').replace(/^0/, '')}:${getPart('minute')}${getPart('dayPeriod') ? ` ${getPart('dayPeriod')}` : ''}${getPart('timeZoneName') ? ` ${getPart('timeZoneName')}` : ''}`.trim();
};

describe('export notes', () => {
  it('renders a slide png with the PDF page and annotations', async () => {
    const calls: unknown[] = [];
    const context = {
      save: vi.fn(() => calls.push('save')),
      restore: vi.fn(() => calls.push('restore')),
      beginPath: vi.fn(() => calls.push('beginPath')),
      moveTo: vi.fn((x: number, y: number) => calls.push(['moveTo', x, y])),
      lineTo: vi.fn((x: number, y: number) => calls.push(['lineTo', x, y])),
      stroke: vi.fn(() => calls.push('stroke')),
      fillRect: vi.fn((x: number, y: number, w: number, h: number) =>
        calls.push(['fillRect', x, y, w, h]),
      ),
      strokeRect: vi.fn((x: number, y: number, w: number, h: number) =>
        calls.push(['strokeRect', x, y, w, h]),
      ),
      fillText: vi.fn((text: string, x: number, y: number) =>
        calls.push(`fillText:${text}:${x}:${y}`),
      ),
      measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
      setTransform: vi.fn(),
      lineCap: 'round',
      lineJoin: 'round',
      strokeStyle: '#000000',
      fillStyle: '#ffffff',
      lineWidth: 1,
      textBaseline: 'top',
      font: '',
    } as unknown as CanvasRenderingContext2D;

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,exported'),
    } as unknown as HTMLCanvasElement;

    const image = await renderAnnotatedSlidePng({
      filePath: 'C:/slides/talk.pdf',
      slideNumber: 2,
      annotations: [
        {
          id: 'stroke-1',
          kind: 'stroke',
          points: [
            { x: 0.1, y: 0.2, pressure: 0.5, time: 1 },
            { x: 0.3, y: 0.4, pressure: 0.7, time: 2 },
          ],
        },
        {
          id: 'note-1',
          kind: 'text',
          x: 0.5,
          y: 0.25,
          text: 'Keep this',
        },
      ],
      readPdfBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      loadPdfDocument: vi.fn().mockResolvedValue({
        document: {
          getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn(({ scale }: { scale: number }) => ({
              width: 100 * scale,
              height: 200 * scale,
            })),
            getAnnotations: vi.fn().mockResolvedValue([]),
            getTextContent: vi.fn().mockResolvedValue({ items: [] }),
            render: vi.fn(() => ({ promise: Promise.resolve() })),
          }),
        },
        destroy: vi.fn().mockResolvedValue(undefined),
      }),
      createCanvas: () => canvas,
      exportScale: 2,
    });

    expect(image).toEqual({
      imageDataUrl: 'data:image/png;base64,exported',
      links: [],
    });
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(400);
    expect(calls).toContain('stroke');
    expect(
      calls.some(
        (entry) =>
          typeof entry === 'string' && entry.startsWith('fillText:Keep this'),
      ),
    ).toBe(true);
  });

  it('builds deterministic markdown for annotated talks and slides', () => {
    const snapshot: ConferenceExportSnapshot = {
      conference: {
        id: 'conference-1',
        title: 'IndicoInk Summit',
        dates: 'June 12-14, 2026',
        host: 'indico.example.org',
        sourceUrl: 'https://indico.example.org/event/summit',
        exportedAt: 1700000000000,
      },
      talks: [
        {
          id: 'talk-1',
          contributionId: 'talk-1',
          contributionUrl:
            'https://indico.example.org/event/summit/contributions/talk-1/',
          title: 'Annotation review',
          speaker: 'Ada Lovelace',
          sessionTitle: 'Notes session',
          startsAt: 1700003600000,
          endsAt: 1700005400000,
          room: 'Room A',
          bookmarked: true,
          decks: [
            {
              id: 'deck-1',
              displayName: 'Slides',
              sourceUrl: 'https://indico.example.org/materials/slides.pdf',
              filePath: 'C:/slides/slides.pdf',
              selected: true,
              slides: [
                {
                  id: 'slide-1',
                  slideNumber: 3,
                  filePath: 'C:/slides/slides.pdf',
                  annotations: [
                    {
                      id: 'stroke-1',
                      kind: 'stroke',
                      points: [
                        { x: 0.1, y: 0.2, pressure: 0.4, time: 1 },
                        { x: 0.25, y: 0.3, pressure: 0.7, time: 2 },
                      ],
                    },
                    {
                      id: 'note-1',
                      kind: 'text',
                      x: 0.5,
                      y: 0.75,
                      text: 'Call out the result',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const markdown = buildConferenceNotesMarkdown(snapshot, [
      {
        talkId: 'talk-1',
        contributionId: 'talk-1',
        contributionUrl:
          'https://indico.example.org/event/summit/contributions/talk-1/',
        talkTitle: 'Annotation review',
        sessionTitle: 'Notes session',
        deckId: 'deck-1',
        deckDisplayName: 'Slides',
        deckSourceUrl: 'https://indico.example.org/materials/slides.pdf',
        slideNumber: 3,
        imageDataUrl: 'data:image/png;base64,exported',
        links: [
          {
            label: 'ATL-COM-03',
            url: 'https://cds.cern.ch/document/1.pdf',
          },
        ],
      },
    ]);

    expect(markdown).toContain(
      '- [Conference URL](https://indico.example.org/event/summit)',
    );
    expect(markdown).toContain(
      `- Exported at: ${formatLocalDateTimeForTest(1700000000000)}`,
    );
    expect(markdown).toContain('## Annotation review');
    expect(markdown).toContain('- Speaker: Ada Lovelace');
    expect(markdown).toContain('- Session: Notes session');
    expect(markdown).toContain(
      `- Time: ${formatLocalDateTimeForTest(1700003600000)} (30 minutes)`,
    );
    expect(markdown).toContain(
      '- [Original Slides](https://indico.example.org/materials/slides.pdf)',
    );
    expect(markdown).toContain(
      '- ![Annotated slide 3](<data:image/png;base64,exported>)',
    );
    expect(markdown).toContain(
      '  - [ATL-COM-03](<https://cds.cern.ch/document/1.pdf>)',
    );
    expect(markdown).not.toContain('Host:');
    expect(markdown).not.toContain('Contribution:');
    expect(markdown).not.toContain('Room:');
    expect(markdown).not.toContain('Annotations:');
    expect(markdown).toContain('Annotated slide 3');
    expect(markdown).not.toContain('Time:\n\n- [Original Slides]');
  });

  it('omits the session line when the session is unscheduled', () => {
    const snapshot: ConferenceExportSnapshot = {
      conference: {
        id: 'conference-1',
        title: 'IndicoInk Summit',
        dates: 'June 12-14, 2026',
        host: 'indico.example.org',
        sourceUrl: 'https://indico.example.org/event/summit',
        exportedAt: 1700000000000,
      },
      talks: [
        {
          id: 'talk-2',
          contributionId: 'talk-2',
          contributionUrl:
            'https://indico.example.org/event/summit/contributions/talk-2/',
          title: 'Unscheduled talk',
          speaker: 'Grace Hopper',
          sessionTitle: 'Unscheduled',
          startsAt: null,
          endsAt: null,
          room: 'Room B',
          bookmarked: false,
          decks: [],
        },
      ],
    };

    const markdown = buildConferenceNotesMarkdown(snapshot, []);
    expect(markdown).not.toContain('Session:');
  });
});
