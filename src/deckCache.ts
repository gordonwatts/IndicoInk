import { mkdirSync, existsSync, unlinkSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import type { Deck } from './persistenceModels';
import type {
  DeckCacheDownloadStatus,
  DeckCacheOpenResult,
} from './shared/deckCache';

type DeckCacheFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: {
    get(name: string): string | null;
  };
  body: {
    getReader(): ReadableStreamDefaultReader<Uint8Array>;
  } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type FetchDeckBytes = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<DeckCacheFetchResponse>;

type DownloadRecord = {
  status: DeckCacheDownloadStatus;
  controller: AbortController;
  filePath: string;
  tempPath: string;
};

const createCacheFilePath = (
  cacheRoot: string,
  conferenceId: string,
  deckId: string,
) => join(cacheRoot, conferenceId, `${deckId}.pdf`);

export class DeckCacheManager {
  private readonly downloads = new Map<string, DownloadRecord>();

  constructor(
    private readonly cacheRoot: string,
    private readonly fetchDeckBytes: FetchDeckBytes,
    private readonly now = () => Date.now(),
  ) {}

  getCacheFilePath(conferenceId: string, deckId: string) {
    return createCacheFilePath(this.cacheRoot, conferenceId, deckId);
  }

  getDownloadStatus(operationId: string) {
    return this.downloads.get(operationId)?.status ?? null;
  }

  async cancelDownload(operationId: string) {
    const record = this.downloads.get(operationId);
    if (!record) {
      return;
    }

    record.controller.abort();
    await this.cleanupPartialDownload(record);
    record.status = {
      ...record.status,
      kind: 'canceled',
      message: 'Download canceled.',
      updatedAt: this.now(),
    };
  }

  async openDeck(deck: Deck): Promise<DeckCacheOpenResult> {
    const filePath = this.getCacheFilePath(deck.conferenceId, deck.id);
    mkdirSync(dirname(filePath), { recursive: true });

    if (existsSync(filePath)) {
      return {
        kind: 'ready',
        conferenceId: deck.conferenceId,
        talkId: deck.talkId,
        deckId: deck.id,
        sourceUrl: deck.sourceUrl,
        displayName: deck.displayName,
        filePath,
        pageCount: 0,
      };
    }

    const operationId = randomUUID();
    const status: DeckCacheDownloadStatus = {
      operationId,
      conferenceId: deck.conferenceId,
      talkId: deck.talkId,
      deckId: deck.id,
      sourceUrl: deck.sourceUrl,
      displayName: deck.displayName,
      filePath,
      kind: 'queued',
      bytesDownloaded: 0,
      totalBytes: null,
      message: null,
      updatedAt: this.now(),
    };

    const controller = new AbortController();
    const tempPath = `${filePath}.${operationId}.download`;
    const record: DownloadRecord = { status, controller, filePath, tempPath };
    this.downloads.set(operationId, record);
    void this.performDownload(record, deck);

    return {
      kind: 'downloading',
      conferenceId: deck.conferenceId,
      talkId: deck.talkId,
      deckId: deck.id,
      sourceUrl: deck.sourceUrl,
      displayName: deck.displayName,
      filePath,
      pageCount: 0,
      operationId,
    };
  }

  private async performDownload(record: DownloadRecord, deck: Deck) {
    const { status, controller, tempPath, filePath } = record;
    try {
      status.kind = 'downloading';
      status.message = 'Downloading PDF...';
      status.updatedAt = this.now();

      const response = await this.fetchDeckBytes(deck.sourceUrl, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Failed to download ${deck.displayName}: HTTP ${response.status} ${response.statusText}`,
        );
      }

      const declaredLength = response.headers.get('content-length');
      status.totalBytes = declaredLength ? Number(declaredLength) : null;
      mkdirSync(dirname(filePath), { recursive: true });

      if (response.body) {
        const reader = response.body.getReader();
        const handle = await open(tempPath, 'w');
        try {
          let streamDone = false;
          while (!streamDone) {
            const result = await reader.read();
            streamDone = Boolean(result.done);
            if (controller.signal.aborted) {
              throw new Error('Download canceled.');
            }

            if (result.value) {
              await handle.write(Buffer.from(result.value));
              status.bytesDownloaded += result.value.byteLength;
              status.updatedAt = this.now();
            }
          }
        } finally {
          await handle.close();
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        await open(tempPath, 'w').then(async (handle) => {
          try {
            await handle.write(bytes);
          } finally {
            await handle.close();
          }
        });
        status.bytesDownloaded = bytes.byteLength;
        status.updatedAt = this.now();
      }

      if (controller.signal.aborted) {
        throw new Error('Download canceled.');
      }

      renameSync(tempPath, filePath);
      status.kind = 'ready';
      status.message = 'Download complete.';
      status.updatedAt = this.now();
    } catch (error) {
      await this.cleanupPartialDownload(record);
      status.kind = controller.signal.aborted ? 'canceled' : 'error';
      status.message =
        error instanceof Error ? error.message : 'Failed to download PDF.';
      status.updatedAt = this.now();
    }
  }

  private async cleanupPartialDownload(record: DownloadRecord) {
    try {
      if (existsSync(record.tempPath)) {
        unlinkSync(record.tempPath);
      }
    } catch {
      // Ignore cleanup failures for canceled or interrupted downloads.
    }
  }
}
