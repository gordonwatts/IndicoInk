import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

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
});
