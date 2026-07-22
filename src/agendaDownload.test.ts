import { describe, expect, it, vi } from 'vitest';

import { AgendaDownloadManager } from './agendaDownload';
import type { Deck, Talk } from './persistenceModels';

const makeTalk = (id: string): Talk => ({ id }) as Talk;

const makeDeck = (id: string, mimeType = 'application/pdf'): Deck =>
  ({
    id,
    conferenceId: 'conference-1',
    talkId: 'talk-1',
    displayName: `Deck ${id}`,
    mimeType,
  }) as Deck;

describe('agenda download manager', () => {
  it('downloads every PDF deck while ignoring non-PDF materials', async () => {
    const ensureDeckAvailable = vi.fn().mockResolvedValue({
      kind: 'ready',
      restored: true,
      filePath: 'C:/cache/deck.pdf',
    });
    const store = {
      listTalksByConference: vi
        .fn()
        .mockResolvedValue([makeTalk('talk-1'), makeTalk('talk-2')]),
      listDecksByTalk: vi
        .fn()
        .mockResolvedValueOnce([
          makeDeck('deck-1'),
          makeDeck('notes-1', 'text/plain'),
        ])
        .mockResolvedValueOnce([makeDeck('deck-2')]),
    };
    const manager = new AgendaDownloadManager(store, ensureDeckAvailable);

    const result = manager.startDownload('conference-1');

    await vi.waitFor(() => {
      expect(manager.getDownloadStatus(result.operationId)?.kind).toBe('ready');
    });

    expect(ensureDeckAvailable).toHaveBeenCalledTimes(2);
    expect(manager.getDownloadStatus(result.operationId)).toEqual(
      expect.objectContaining({
        totalDecks: 2,
        completedDecks: 2,
        failedDecks: 0,
        message: 'Agenda ready for offline use.',
      }),
    );
  });

  it('reports failed decks after attempting the complete agenda', async () => {
    const ensureDeckAvailable = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'error', message: 'Unavailable' })
      .mockResolvedValueOnce({
        kind: 'ready',
        restored: false,
        filePath: 'C:/cache/deck-2.pdf',
      });
    const store = {
      listTalksByConference: vi.fn().mockResolvedValue([makeTalk('talk-1')]),
      listDecksByTalk: vi
        .fn()
        .mockResolvedValue([makeDeck('deck-1'), makeDeck('deck-2')]),
    };
    const manager = new AgendaDownloadManager(store, ensureDeckAvailable);

    const result = manager.startDownload('conference-1');

    await vi.waitFor(() => {
      expect(manager.getDownloadStatus(result.operationId)?.kind).toBe('error');
    });

    expect(ensureDeckAvailable).toHaveBeenCalledTimes(2);
    expect(manager.getDownloadStatus(result.operationId)).toEqual(
      expect.objectContaining({
        completedDecks: 2,
        failedDecks: 1,
        message: '1 PDF could not be downloaded.',
      }),
    );
  });

  it('does not start another download for the same conference while active', async () => {
    let releaseTalks!: (talks: Talk[]) => void;
    const talks = new Promise<Talk[]>((resolve) => {
      releaseTalks = resolve;
    });
    const store = {
      listTalksByConference: vi.fn().mockReturnValue(talks),
      listDecksByTalk: vi.fn(),
    };
    const manager = new AgendaDownloadManager(store, vi.fn());

    const first = manager.startDownload('conference-1');
    const second = manager.startDownload('conference-1');

    expect(second).toEqual(first);
    releaseTalks([]);
    await vi.waitFor(() => {
      expect(manager.getDownloadStatus(first.operationId)?.kind).toBe('ready');
    });
    expect(store.listTalksByConference).toHaveBeenCalledOnce();
  });
});
