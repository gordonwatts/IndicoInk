import { randomUUID } from 'node:crypto';

import type { Deck, Talk } from './persistenceModels';
import type { DeckCacheEnsureResult } from './shared/deckCache';
import type {
  AgendaDownloadStartResult,
  AgendaDownloadSummary,
  AgendaDownloadStatus,
} from './shared/agendaDownload';

type AgendaDownloadStore = {
  listTalksByConference(conferenceId: string): Promise<Talk[]>;
  listDecksByTalk(talkId: string): Promise<Deck[]>;
};

type AgendaDownloadRecord = {
  status: AgendaDownloadStatus;
  canceled: boolean;
};

type EnsureDeckAvailable = (deck: Deck) => Promise<DeckCacheEnsureResult>;
type IsDeckCached = (deck: Deck) => Promise<boolean>;

export class AgendaDownloadManager {
  private readonly downloads = new Map<string, AgendaDownloadRecord>();

  constructor(
    private readonly store: AgendaDownloadStore,
    private readonly ensureDeckAvailable: EnsureDeckAvailable,
    private readonly isDeckCached: IsDeckCached = async () => false,
    private readonly now = () => Date.now(),
  ) {}

  getDownloadStatus(operationId: string): AgendaDownloadStatus | null {
    return this.downloads.get(operationId)?.status ?? null;
  }

  async getDownloadSummary(
    conferenceId: string,
  ): Promise<AgendaDownloadSummary> {
    const talkDeckGroups = await this.getTalkDeckGroups(conferenceId);
    const downloadedTalks = (
      await Promise.all(
        talkDeckGroups.map(async ({ decks }) =>
          (
            await Promise.all(decks.map((deck) => this.isDeckCached(deck)))
          ).every(Boolean),
        ),
      )
    ).filter(Boolean).length;

    return {
      downloadedTalks,
      totalTalks: talkDeckGroups.length,
    };
  }

  startDownload(conferenceId: string): AgendaDownloadStartResult {
    const activeDownload = Array.from(this.downloads.values()).find(
      (record) =>
        record.status.conferenceId === conferenceId &&
        (record.status.kind === 'queued' ||
          record.status.kind === 'downloading'),
    );
    if (activeDownload) {
      return {
        operationId: activeDownload.status.operationId,
        conferenceId,
      };
    }

    const operationId = randomUUID();
    const startedAt = this.now();
    const record: AgendaDownloadRecord = {
      status: {
        operationId,
        conferenceId,
        startedAt,
        kind: 'queued',
        totalDecks: 0,
        completedDecks: 0,
        failedDecks: 0,
        downloadedTalks: 0,
        totalTalks: 0,
        currentDeckTitle: null,
        message: 'Preparing talks download...',
        updatedAt: startedAt,
      },
      canceled: false,
    };
    this.downloads.set(operationId, record);
    void this.runDownload(record);

    return { operationId, conferenceId };
  }

  cancelDownload(operationId: string): void {
    const record = this.downloads.get(operationId);
    if (
      !record ||
      record.status.kind === 'ready' ||
      record.status.kind === 'error'
    ) {
      return;
    }

    record.canceled = true;
    record.status = {
      ...record.status,
      kind: 'canceled',
      currentDeckTitle: null,
      message: 'Talks download canceled.',
      updatedAt: this.now(),
    };
  }

  private async runDownload(record: AgendaDownloadRecord) {
    try {
      const talkDeckGroups = await this.getTalkDeckGroups(
        record.status.conferenceId,
      );
      const decks = talkDeckGroups.flatMap(({ decks: talkDecks }) => talkDecks);

      if (record.canceled) {
        return;
      }

      record.status = {
        ...record.status,
        kind: 'downloading',
        totalTalks: talkDeckGroups.length,
        totalDecks: decks.length,
        message: decks.length
          ? `Downloading ${decks.length} PDF${decks.length === 1 ? '' : 's'}...`
          : 'No PDF materials found for these talks.',
        updatedAt: this.now(),
      };

      for (const { decks: talkDecks } of talkDeckGroups) {
        if (record.canceled) {
          return;
        }

        let talkDownloaded = true;
        for (const deck of talkDecks) {
          record.status = {
            ...record.status,
            currentDeckTitle: deck.displayName,
            message: `Downloading ${deck.displayName}...`,
            updatedAt: this.now(),
          };

          const result = await this.ensureDeckAvailable(deck);
          if (record.canceled) {
            return;
          }

          const failedDecks =
            result.kind === 'ready'
              ? record.status.failedDecks
              : record.status.failedDecks + 1;
          if (result.kind !== 'ready') {
            talkDownloaded = false;
          }
          record.status = {
            ...record.status,
            completedDecks: record.status.completedDecks + 1,
            failedDecks,
            updatedAt: this.now(),
          };
        }

        if (talkDownloaded) {
          record.status = {
            ...record.status,
            downloadedTalks: record.status.downloadedTalks + 1,
            updatedAt: this.now(),
          };
        }
      }

      const failedDecks = record.status.failedDecks;
      record.status = {
        ...record.status,
        kind: failedDecks ? 'error' : 'ready',
        currentDeckTitle: null,
        message: failedDecks
          ? `${failedDecks} PDF${failedDecks === 1 ? '' : 's'} could not be downloaded.`
          : 'Talks ready for offline use.',
        updatedAt: this.now(),
      };
    } catch (error) {
      if (record.canceled) {
        return;
      }

      record.status = {
        ...record.status,
        kind: 'error',
        currentDeckTitle: null,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to download the talks.',
        updatedAt: this.now(),
      };
    }
  }

  private async getTalkDeckGroups(conferenceId: string) {
    const talks = await this.store.listTalksByConference(conferenceId);
    return (
      await Promise.all(
        talks.map(async (talk) => ({
          decks: await this.store.listDecksByTalk(talk.id),
        })),
      )
    )
      .map(({ decks }) => ({
        decks: decks.filter((deck) => deck.mimeType === 'application/pdf'),
      }))
      .filter(({ decks }) => decks.length > 0);
  }
}
