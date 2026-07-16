import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DeckCacheManager } from './deckCache';
import type { Deck } from './persistenceModels';

const createTempDir = (name: string) =>
  mkdtempSync(join(tmpdir(), `indicoink-${name}-`));

const makeDeck = (): Deck => ({
  id: 'deck-1',
  conferenceId: 'conference-1',
  talkId: 'talk-1',
  sourceUrl: 'https://example.org/materials/deck.pdf',
  displayName: 'Slides',
  mimeType: 'application/pdf',
  selected: true,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
});

const makeDownloadResponse = (
  overrides: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    text?: () => Promise<string>;
    body?: {
      getReader(): ReadableStreamDefaultReader<Uint8Array>;
    } | null;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  } = {},
) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: {
    get: vi.fn().mockReturnValue(null),
  },
  body: null,
  arrayBuffer: vi
    .fn()
    .mockResolvedValue(Buffer.from('%PDF-1.4\n% downloaded\n').buffer),
  ...overrides,
});

describe('deck cache manager', () => {
  it('reopens an existing cached deck without downloading it again', async () => {
    const cacheRoot = createTempDir('deck-cache-ready');
    const manager = new DeckCacheManager(cacheRoot, vi.fn());
    const deck = makeDeck();
    const filePath = manager.getCacheFilePath(deck.conferenceId, deck.id);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, Buffer.from('%PDF-1.4\n% cached\n'));

    await expect(manager.openDeck(deck)).resolves.toEqual(
      expect.objectContaining({
        kind: 'ready',
        filePath,
        deckId: deck.id,
      }),
    );
    expect(existsSync(filePath)).toBe(true);
  });

  it('treats an empty or non-PDF cache entry as a miss and restores it', async () => {
    const cacheRoot = createTempDir('deck-cache-invalid');
    const fetchDeckBytes = vi.fn().mockResolvedValue(makeDownloadResponse());
    const manager = new DeckCacheManager(cacheRoot, fetchDeckBytes);
    const deck = makeDeck();
    const filePath = manager.getCacheFilePath(deck.conferenceId, deck.id);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, 'partial download');

    await expect(manager.ensureDeckAvailable(deck)).resolves.toEqual({
      kind: 'ready',
      restored: true,
      filePath,
    });
    expect(fetchDeckBytes).toHaveBeenCalledOnce();
    expect(existsSync(filePath)).toBe(true);
  });

  it('waits for export recovery and preserves a valid cache during a failed refresh', async () => {
    const cacheRoot = createTempDir('deck-cache-recovery-error');
    const fetchDeckBytes = vi.fn().mockResolvedValue(
      makeDownloadResponse({
        ok: false,
        status: 503,
        statusText: 'Unavailable',
      }),
    );
    const manager = new DeckCacheManager(cacheRoot, fetchDeckBytes);
    const deck = makeDeck();
    const filePath = manager.getCacheFilePath(deck.conferenceId, deck.id);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, 'not a pdf');

    await expect(manager.ensureDeckAvailable(deck)).resolves.toEqual(
      expect.objectContaining({ kind: 'error', filePath }),
    );
    expect(readFileSync(filePath, 'utf8')).toBe('not a pdf');
  });

  it('cancels an interrupted download and removes the partial cache file', async () => {
    const cacheRoot = createTempDir('deck-cache-cancel');
    let abortHandler: (() => void) | null = null;
    const fetchDeckBytes = vi.fn().mockResolvedValue(
      makeDownloadResponse({
        body: {
          getReader: () =>
            ({
              read: () =>
                new Promise<ReadableStreamReadResult<Uint8Array>>(
                  (_resolve, reject) => {
                    abortHandler = () => {
                      reject(new Error('aborted'));
                    };
                  },
                ),
            }) as ReadableStreamDefaultReader<Uint8Array>,
        },
      }),
    );
    const manager = new DeckCacheManager(cacheRoot, fetchDeckBytes);
    const deck = makeDeck();

    const openResult = await manager.openDeck(deck);
    expect(openResult.kind).toBe('downloading');
    if (openResult.kind !== 'downloading') {
      throw new Error('Expected a download to start.');
    }
    expect(manager.getDownloadStatus(openResult.operationId)).toEqual(
      expect.objectContaining({
        startedAt: expect.any(Number),
      }),
    );
    const filePath = manager.getCacheFilePath(deck.conferenceId, deck.id);

    await manager.cancelDownload(openResult.operationId);
    const handler = abortHandler as (() => void) | null;
    if (typeof handler === 'function') {
      handler();
    }

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(manager.getDownloadStatus(openResult.operationId)?.kind).toBe(
      'canceled',
    );
    expect(existsSync(filePath)).toBe(false);
  });

  it('adds a stored API key to download requests for the deck origin', async () => {
    const cacheRoot = createTempDir('deck-cache-api-key');
    const fetchDeckBytes = vi.fn().mockResolvedValue(makeDownloadResponse());
    const manager = new DeckCacheManager(
      cacheRoot,
      fetchDeckBytes,
      async () => 'secret-api-key',
    );

    await manager.openDeck(makeDeck());

    const requestedUrl = new URL(fetchDeckBytes.mock.calls[0]![0]);
    expect(requestedUrl.searchParams.get('ak')).toBe('secret-api-key');
  });

  it('adds a stored API token as a bearer header for deck downloads', async () => {
    const cacheRoot = createTempDir('deck-cache-token');
    const fetchDeckBytes = vi.fn().mockResolvedValue(makeDownloadResponse());
    const manager = new DeckCacheManager(
      cacheRoot,
      fetchDeckBytes,
      async () => 'indp_test-token',
    );

    await manager.openDeck(makeDeck());

    const requestedUrl = new URL(fetchDeckBytes.mock.calls[0]![0]);
    expect(requestedUrl.searchParams.get('ak')).toBeNull();
    expect(fetchDeckBytes.mock.calls[0]![1]?.headers).toEqual({
      Authorization: 'Bearer indp_test-token',
    });
  });

  it('reports API-key-required responses before starting a download', async () => {
    const cacheRoot = createTempDir('deck-cache-auth');
    const fetchDeckBytes = vi.fn().mockResolvedValue(
      makeDownloadResponse({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: vi
          .fn()
          .mockResolvedValue('<html>API key required for this deck</html>'),
      }),
    );
    const manager = new DeckCacheManager(cacheRoot, fetchDeckBytes);
    const deck = makeDeck();

    await expect(manager.openDeck(deck)).resolves.toEqual(
      expect.objectContaining({
        kind: 'api-key-required',
        origin: 'https://example.org',
        deckId: deck.id,
      }),
    );
  });

  it('reports insufficient token scope as an API-key-required deck response', async () => {
    const cacheRoot = createTempDir('deck-cache-scope');
    const fetchDeckBytes = vi.fn().mockResolvedValue(
      makeDownloadResponse({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            error: 'insufficient_scope',
            error_description:
              'The request requires higher privileges than provided by the access token.',
          }),
        ),
      }),
    );
    const manager = new DeckCacheManager(cacheRoot, fetchDeckBytes);

    await expect(manager.openDeck(makeDeck())).resolves.toEqual(
      expect.objectContaining({
        kind: 'api-key-required',
        message:
          'This API token needs additional Indico file access before this slide deck can be opened.',
      }),
    );
  });
});
