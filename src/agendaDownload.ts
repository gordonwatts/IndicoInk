import { randomUUID } from 'node:crypto';

import type { Deck, Talk } from './persistenceModels';
import type { DeckCacheEnsureResult } from './shared/deckCache';
import type {
  AgendaDownloadStartResult,
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

export class AgendaDownloadManager {
  private readonly downloads = new Map<string, AgendaDownloadRecord>();

  constructor(
    private readonly store: AgendaDownloadStore,
    private readonly ensureDeckAvailable: EnsureDeckAvailable,
    private readonly now = () => Date.now(),
  ) {}

  getDownloadStatus(operationId: string): AgendaDownloadStatus | null {
    return this.downloads.get(operationId)?.status ?? null;
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
        currentDeckTitle: null,
        message: 'Preparing agenda download...',
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
      message: 'Agenda download canceled.',
      updatedAt: this.now(),
    };
  }

  private async runDownload(record: AgendaDownloadRecord) {
    try {
      const talks = await this.store.listTalksByConference(
        record.status.conferenceId,
      );
      const decks = (
        await Promise.all(
          talks.map(async (talk) => this.store.listDecksByTalk(talk.id)),
        )
      )
        .flat()
        .filter((deck) => deck.mimeType === 'application/pdf');

      if (record.canceled) {
        return;
      }

      record.status = {
        ...record.status,
        kind: 'downloading',
        totalDecks: decks.length,
        message: decks.length
          ? `Downloading ${decks.length} PDF${decks.length === 1 ? '' : 's'}...`
          : 'No PDF materials found for this agenda.',
        updatedAt: this.now(),
      };

      for (const deck of decks) {
        if (record.canceled) {
          return;
        }

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
        record.status = {
          ...record.status,
          completedDecks: record.status.completedDecks + 1,
          failedDecks,
          updatedAt: this.now(),
        };
      }

      const failedDecks = record.status.failedDecks;
      record.status = {
        ...record.status,
        kind: failedDecks ? 'error' : 'ready',
        currentDeckTitle: null,
        message: failedDecks
          ? `${failedDecks} PDF${failedDecks === 1 ? '' : 's'} could not be downloaded.`
          : 'Agenda ready for offline use.',
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
            : 'Failed to download the agenda.',
        updatedAt: this.now(),
      };
    }
  }
}
