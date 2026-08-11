// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  MAX_WEB_AGENDA_BYTES,
  WebAgendaAuthenticationError,
  WebAgendaError,
  extractWebAgenda,
  fetchNormalizedWebAgenda,
  mapExtractedWebAgenda,
  normalizeOpenAiBaseUrl,
  normalizeWebAgendaHtml,
  normalizeWebAgendaUrl,
  type ExtractedWebAgenda,
} from './webAgenda';

const sourceUrl = 'https://events.example.org/workshop/';

describe('web agenda extraction boundary', () => {
  it('accepts HTTPS and loopback HTTP while rejecting remote HTTP', () => {
    expect(normalizeWebAgendaUrl(sourceUrl)).toBe(sourceUrl);
    expect(normalizeWebAgendaUrl('http://127.0.0.1:8080/agenda')).toBe(
      'http://127.0.0.1:8080/agenda',
    );
    expect(() => normalizeWebAgendaUrl('http://events.example.org/')).toThrow(
      /must use https/i,
    );
    expect(normalizeOpenAiBaseUrl('https://api.example.org/v1/')).toBe(
      'https://api.example.org/v1',
    );
  });

  it('removes active and navigation content and resolves an explicit link allowlist', () => {
    const page = normalizeWebAgendaHtml(
      `<!doctype html><body>
        <nav>Ignore navigation</nav><script>ignore()</script><style>.x{}</style>
        <h1>IAIFI Summer Workshop</h1>
        <section><h2>Plenary</h2><p>09:00 A Physics Talk, A. Author</p>
        <a href="slides/talk.pdf">Talk slides</a>
        <a href="mailto:test@example.org">Email</a></section>
      </body>`,
      sourceUrl,
    );

    expect(page.content).toContain('IAIFI Summer Workshop');
    expect(page.content).toContain(
      'Talk slides [https://events.example.org/workshop/slides/talk.pdf]',
    );
    expect(page.content).not.toContain('Ignore navigation');
    expect(page.content).not.toContain('ignore()');
    expect([...page.allowedLinks]).toEqual([
      'https://events.example.org/workshop/slides/talk.pdf',
    ]);
  });

  it('enforces the HTML response size before normalization', async () => {
    const oversized = new Uint8Array(MAX_WEB_AGENDA_BYTES + 1);
    const fetchImpl = async () =>
      new Response(oversized, {
        headers: { 'content-type': 'text/html' },
      });

    await expect(
      fetchNormalizedWebAgenda(sourceUrl, fetchImpl),
    ).rejects.toThrow(/larger than 2 MB/i);
  });

  it('classifies OpenAI 401 responses as reconfiguration-required authentication failures', async () => {
    const page = normalizeWebAgendaHtml(
      '<body><h1>Workshop</h1></body>',
      sourceUrl,
    );
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'Invalid API key',
            type: 'invalid_request_error',
          },
        }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      );

    await expect(
      extractWebAgenda(
        page,
        {
          baseUrl: 'http://127.0.0.1:8080/v1',
          model: 'test-model',
          reasoningEffort: 'medium',
        },
        'invalid-key',
        [],
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(WebAgendaAuthenticationError);
  });

  it('maps authored talks without PDFs and discards model-invented URLs', () => {
    const page = normalizeWebAgendaHtml(
      `<body><h1>Workshop</h1><a href="talk/1">Details</a><a href="slides/1.pdf">PDF</a></body>`,
      sourceUrl,
    );
    const extracted: ExtractedWebAgenda = {
      event: {
        title: 'IAIFI Summer Workshop',
        dates: 'August 3-5, 2026',
        timeZone: 'America/New_York',
        host: 'Institute for Artificial Intelligence',
      },
      talks: [
        {
          priorId: null,
          title: 'Plenary talk',
          authors: ['A. Author'],
          sessionTitle: 'Plenary',
          date: '2026-08-03',
          startTime: '09:00',
          endTime: '10:00',
          room: 'Auditorium',
          contributionUrl: 'https://events.example.org/workshop/talk/1',
          pdfMaterials: [
            { title: 'Slides', url: 'slides/1.pdf' },
            { title: 'Invented', url: 'https://evil.example/invented.pdf' },
          ],
        },
        {
          priorId: null,
          title: 'Dense contributed talk',
          authors: ['B. Author', 'C. Author'],
          sessionTitle: 'Contributed talks',
          date: '2026-08-03',
          startTime: '10:15',
          endTime: null,
          room: null,
          contributionUrl: null,
          pdfMaterials: [],
        },
      ],
    };

    const mapped = mapExtractedWebAgenda(page, extracted);

    expect(mapped.conference.sourceKind).toBe('web');
    expect(mapped.talks).toHaveLength(2);
    expect(mapped.talks[0]?.speaker).toBe('A. Author');
    expect(mapped.talks[0]?.materials).toHaveLength(1);
    expect(mapped.talks[1]?.materials).toEqual([]);
    expect(mapped.talks[1]?.contributionUrl).toBe(sourceUrl);
  });

  it('reuses only known prior IDs and rejects duplicates or foreign IDs', () => {
    const page = normalizeWebAgendaHtml(
      '<body><h1>Workshop</h1></body>',
      sourceUrl,
    );
    const prior = {
      contributionId: 'web-existing',
      title: 'Existing talk',
      speaker: 'A. Author',
      sessionTitle: 'Session',
      startsAt: null,
      endsAt: null,
      room: '',
      contributionUrl: sourceUrl,
      materials: [],
    };
    const talk = {
      priorId: 'web-existing',
      title: 'Existing talk',
      authors: ['A. Author'],
      sessionTitle: 'Session',
      date: null,
      startTime: null,
      endTime: null,
      room: null,
      contributionUrl: null,
      pdfMaterials: [],
    };
    const base: ExtractedWebAgenda = {
      event: { title: 'Workshop', dates: '2026', timeZone: null, host: null },
      talks: [talk],
    };

    expect(
      mapExtractedWebAgenda(page, base, [prior]).talks[0]?.contributionId,
    ).toBe('web-existing');
    expect(() =>
      mapExtractedWebAgenda(page, { ...base, talks: [talk, talk] }, [prior]),
    ).toThrow(/more than once/i);
    expect(() =>
      mapExtractedWebAgenda(
        page,
        {
          ...base,
          talks: [{ ...talk, priorId: 'foreign-id' }],
        },
        [prior],
      ),
    ).toThrow(WebAgendaError);
    expect(() =>
      mapExtractedWebAgenda(page, {
        ...base,
        event: { ...base.event, timeZone: 'Not/A_Timezone' },
      }),
    ).toThrow(/invalid IANA timezone/i);
  });
});
