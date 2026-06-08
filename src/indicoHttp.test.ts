import { describe, expect, it, vi } from 'vitest';

import { parseIndicoEventUrl } from './indicoEvent';
import {
  fetchIndicoJson,
  IndicoHttpError,
  IndicoResponseParseError,
  IndicoResponseSizeError,
  IndicoTimeoutError,
  isLikelyIndicoApiKeyError,
  type IndicoJsonResponse,
} from './indicoHttp';

const identity = parseIndicoEventUrl('https://indico.in2p3.fr/event/35043');

if (!identity) {
  throw new Error('Expected the Indico event URL to parse.');
}

const makeResponse = (overrides: Partial<IndicoJsonResponse> = {}) =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: vi.fn().mockReturnValue(null),
    },
    text: vi.fn().mockResolvedValue('{}'),
    ...overrides,
  }) as IndicoJsonResponse;

describe('fetchIndicoJson', () => {
  it('returns parsed JSON for a successful response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        text: vi
          .fn()
          .mockResolvedValue('{"count":1,"results":[{"title":"Test"}]}'),
      }),
    );

    await expect(fetchIndicoJson(identity, { fetchImpl })).resolves.toEqual({
      count: 1,
      results: [{ title: 'Test' }],
    });
  });

  it('throws a timeout error when the request never resolves before the deadline', async () => {
    const fetchImpl = vi.fn(
      (_input: string, init?: { signal?: AbortSignal }) =>
        new Promise<IndicoJsonResponse>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(
              new DOMException('The operation was aborted.', 'AbortError'),
            );
          });
        }),
    );

    await expect(
      fetchIndicoJson(identity, {
        fetchImpl,
        timeoutMilliseconds: 1,
      }),
    ).rejects.toBeInstanceOf(IndicoTimeoutError);
  });

  it('throws an HTTP error for non-success statuses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue('missing'),
      }),
    );

    await expect(
      fetchIndicoJson(identity, { fetchImpl }),
    ).rejects.toMatchObject({
      name: 'IndicoHttpError',
      statusCode: 404,
      responseBody: 'missing',
    } satisfies Partial<IndicoHttpError>);
  });

  it('throws a parse error for invalid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        text: vi.fn().mockResolvedValue('not-json'),
      }),
    );

    await expect(
      fetchIndicoJson(identity, { fetchImpl }),
    ).rejects.toBeInstanceOf(IndicoResponseParseError);
  });

  it('throws a size error when the response is too large', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        headers: {
          get: vi.fn().mockReturnValue('100'),
        },
        text: vi.fn().mockResolvedValue('{"count":1}'),
      }),
    );

    await expect(
      fetchIndicoJson(identity, { fetchImpl, maxBytes: 32 }),
    ).rejects.toBeInstanceOf(IndicoResponseSizeError);
  });

  it('only treats auth-like 403 responses as API-key prompts', () => {
    expect(
      isLikelyIndicoApiKeyError(
        403,
        '<html><title>Just a moment...</title><body>Cloudflare</body></html>',
      ),
    ).toBe(false);
    expect(
      isLikelyIndicoApiKeyError(
        403,
        '<html><body>API key required for this event</body></html>',
      ),
    ).toBe(true);
    expect(isLikelyIndicoApiKeyError(401, '<html>anything</html>')).toBe(
      true,
    );
  });
});
