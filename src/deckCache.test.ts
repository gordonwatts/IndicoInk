import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

  it('cancels an interrupted download and removes the partial cache file', async () => {
    const cacheRoot = createTempDir('deck-cache-cancel');
    let abortHandler: (() => void) | null = null;
    const fetchDeckBytes = vi.fn().mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          abortHandler = () => {
            reject(new Error('aborted'));
          };
        }),
    );
    const manager = new DeckCacheManager(cacheRoot, fetchDeckBytes);
    const deck = makeDeck();

    const openResult = await manager.openDeck(deck);
    expect(openResult.kind).toBe('downloading');
    if (openResult.kind !== 'downloading') {
      throw new Error('Expected a download to start.');
    }
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
});
