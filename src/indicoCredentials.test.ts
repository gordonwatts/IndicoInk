import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import { IndicoCredentialStore } from './indicoCredentials';

const makeStore = () =>
  new IndicoCredentialStore(
    resolve(mkdtempSync(resolve(tmpdir(), 'indicoink-keys-')), 'keys.json'),
    {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`enc:${value}`),
      decryptString: (buffer: Buffer) => buffer.toString('utf8').slice(4),
    },
  );

describe('IndicoCredentialStore', () => {
  it('lists stored API key origins without exposing plaintext keys', async () => {
    const store = makeStore();
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1700000000000)
      .mockReturnValueOnce(1700000001000);

    await store.saveApiKey('https://z.example.org', 'secret-z');
    await store.saveApiKey('https://a.example.org', 'secret-a');

    await expect(store.listApiKeys()).resolves.toEqual([
      { origin: 'https://a.example.org', updatedAt: 1700000001000 },
      { origin: 'https://z.example.org', updatedAt: 1700000000000 },
    ]);

    const rawFile = await readFile(store.filePath, 'utf8');
    expect(rawFile).not.toContain('secret-a');
    expect(rawFile).not.toContain('secret-z');
    nowSpy.mockRestore();
  });

  it('round-trips an encrypted API key without writing plaintext', async () => {
    const store = makeStore();
    const origin = 'https://indico.in2p3.fr';
    const apiKey = 'secret-api-key';

    await store.saveApiKey(origin, apiKey);

    const rawFile = await readFile(store.filePath, 'utf8');
    expect(rawFile).not.toContain(apiKey);
    await expect(store.getApiKey(origin)).resolves.toBe(apiKey);
  });

  it('clears a stored API key', async () => {
    const store = makeStore();
    const origin = 'https://indico.in2p3.fr';

    await store.saveApiKey(origin, 'secret-api-key');
    await store.clearApiKey(origin);

    await expect(store.getApiKey(origin)).resolves.toBeNull();
  });

  it('deletes only the selected API key', async () => {
    const store = makeStore();

    await store.saveApiKey('https://one.example.org', 'secret-one');
    await store.saveApiKey('https://two.example.org', 'secret-two');
    await store.deleteApiKey('https://one.example.org');

    await expect(
      store.getApiKey('https://one.example.org'),
    ).resolves.toBeNull();
    await expect(store.getApiKey('https://two.example.org')).resolves.toBe(
      'secret-two',
    );
  });
});
