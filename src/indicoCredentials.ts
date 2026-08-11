import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import type { IndicoApiKeySummary } from './shared/indicoCredentials';
import type { OpenAiConfigurationSummary } from './shared/openAi';

type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(buffer: Buffer): string;
};

type StoredApiKey =
  | string
  | {
      encryptedApiKey: string;
      updatedAt: number;
    };

type StoredCredentialFile = {
  version: 1 | 2;
  apiKeys: Record<string, StoredApiKey>;
  openAiApiKey?: StoredApiKey;
};

const emptyFile = (): StoredCredentialFile => ({
  version: 2,
  apiKeys: {},
});

export class IndicoCredentialStore {
  constructor(
    public readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
  ) {}

  private assertEncryptionAvailable() {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Electron safeStorage encryption is not available.');
    }
  }

  private async readState(): Promise<StoredCredentialFile> {
    if (!existsSync(this.filePath)) {
      return emptyFile();
    }

    const raw = await readFile(this.filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredCredentialFile>;
    return {
      version: 2,
      apiKeys: parsed.apiKeys ?? {},
      ...(parsed.openAiApiKey ? { openAiApiKey: parsed.openAiApiKey } : {}),
    };
  }

  private async writeState(state: StoredCredentialFile) {
    await writeFile(
      this.filePath,
      `${JSON.stringify(state, null, 2)}\n`,
      'utf8',
    );
  }

  private getEncryptedApiKey(storedApiKey: StoredApiKey) {
    return typeof storedApiKey === 'string'
      ? storedApiKey
      : storedApiKey.encryptedApiKey;
  }

  async getApiKey(origin: string): Promise<string | null> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    const storedApiKey = state.apiKeys[origin];
    if (!storedApiKey) {
      return null;
    }

    return this.safeStorage.decryptString(
      Buffer.from(this.getEncryptedApiKey(storedApiKey), 'base64'),
    );
  }

  async saveApiKey(origin: string, apiKey: string): Promise<void> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    state.apiKeys[origin] = {
      encryptedApiKey: this.safeStorage
        .encryptString(apiKey)
        .toString('base64'),
      updatedAt: Date.now(),
    };
    await this.writeState(state);
  }

  async listApiKeys(): Promise<IndicoApiKeySummary[]> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    return Object.entries(state.apiKeys)
      .map(([origin, storedApiKey]) => ({
        origin,
        updatedAt:
          typeof storedApiKey === 'string' ? 0 : storedApiKey.updatedAt,
      }))
      .sort((left, right) => left.origin.localeCompare(right.origin));
  }

  async clearApiKey(origin: string): Promise<void> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    delete state.apiKeys[origin];
    await this.writeState(state);
  }

  async deleteApiKey(origin: string): Promise<void> {
    await this.clearApiKey(origin);
  }

  async getOpenAiApiKey(): Promise<string | null> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    if (!state.openAiApiKey) {
      return null;
    }

    return this.safeStorage.decryptString(
      Buffer.from(this.getEncryptedApiKey(state.openAiApiKey), 'base64'),
    );
  }

  async saveOpenAiApiKey(apiKey: string): Promise<void> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    state.openAiApiKey = {
      encryptedApiKey: this.safeStorage
        .encryptString(apiKey)
        .toString('base64'),
      updatedAt: Date.now(),
    };
    await this.writeState(state);
  }

  async getOpenAiConfigurationSummary(
    configuration: Omit<
      OpenAiConfigurationSummary,
      'hasApiKey' | 'apiKeyUpdatedAt'
    >,
  ): Promise<OpenAiConfigurationSummary> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    const storedApiKey = state.openAiApiKey;
    return {
      ...configuration,
      hasApiKey: Boolean(storedApiKey),
      apiKeyUpdatedAt:
        storedApiKey && typeof storedApiKey !== 'string'
          ? storedApiKey.updatedAt
          : storedApiKey
            ? 0
            : null,
    };
  }

  async deleteOpenAiApiKey(): Promise<void> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    delete state.openAiApiKey;
    await this.writeState(state);
  }
}
