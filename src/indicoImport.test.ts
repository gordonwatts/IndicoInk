import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import rawPublicEvent from '../tests/fixtures/indico/indico-event-40025.json';

import { PersistenceStore } from './persistenceStore';
import { importIndicoEvent } from './indicoImport';

const makeStore = () =>
  new PersistenceStore(
    resolve(
      mkdtempSync(resolve(tmpdir(), 'indicoink-indico-import-')),
      'db.sqlite3',
    ),
  );

describe('importIndicoEvent', () => {
  it('imports a public Indico event into local conference and talk records', async () => {
    const store = makeStore();

    const result = await importIndicoEvent(
      store,
      'https://indico.in2p3.fr/event/40025',
      {
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: vi.fn().mockReturnValue(null) },
          text: vi.fn().mockResolvedValue(JSON.stringify(rawPublicEvent)),
        }),
      },
    );

    expect(result.title).toBe('DIRAC Project meeting');
    expect(result.talkCount).toBe(5);

    const conferences = await store.listConferences();
    expect(conferences).toHaveLength(1);
    expect(conferences[0]?.title).toBe('DIRAC Project meeting');

    const talks = await store.listTalksByConference(conferences[0]!.id);
    expect(talks).toHaveLength(5);
    expect(talks.map((talk) => talk.title)).toContain('Consortium news');

    await store.close();
  });

  it('keeps existing data when the fetch fails', async () => {
    const store = makeStore();

    await importIndicoEvent(store, 'https://indico.in2p3.fr/event/40025', {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: vi.fn().mockReturnValue(null) },
        text: vi.fn().mockResolvedValue(JSON.stringify(rawPublicEvent)),
      }),
    });

    await expect(
      importIndicoEvent(store, 'https://indico.in2p3.fr/event/40025', {
        fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    ).rejects.toThrow('offline');

    const conferences = await store.listConferences();
    expect(conferences).toHaveLength(1);
    const talks = await store.listTalksByConference(conferences[0]!.id);
    expect(talks).toHaveLength(5);

    await store.close();
  });

  it('rejects an empty Indico export before storing an untitled event', async () => {
    const store = makeStore();

    await expect(
      importIndicoEvent(store, 'https://indico.cern.ch/event/1649690', {
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: vi.fn().mockReturnValue(null) },
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              count: 0,
              additionalInfo: {},
              results: [],
              _type: 'HTTPAPIResult',
            }),
          ),
        }),
      }),
    ).rejects.toMatchObject({
      name: 'IndicoHttpError',
      statusCode: 403,
    });

    await expect(store.listConferences()).resolves.toHaveLength(0);

    await store.close();
  });
});
