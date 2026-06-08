import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(buffer: Buffer): string;
};

type StoredCredentialFile = {
  version: 1;
  apiKeys: Record<string, string>;
};

const emptyFile = (): StoredCredentialFile => ({
  version: 1,
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
      version: 1,
      apiKeys: parsed.apiKeys ?? {},
    };
  }

  private async writeState(state: StoredCredentialFile) {
    await writeFile(
      this.filePath,
      `${JSON.stringify(state, null, 2)}\n`,
      'utf8',
    );
  }

  async getApiKey(origin: string): Promise<string | null> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    const encoded = state.apiKeys[origin];
    if (!encoded) {
      return null;
    }

    return this.safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  }

  async saveApiKey(origin: string, apiKey: string): Promise<void> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    state.apiKeys[origin] = this.safeStorage
      .encryptString(apiKey)
      .toString('base64');
    await this.writeState(state);
  }

  async clearApiKey(origin: string): Promise<void> {
    this.assertEncryptionAvailable();
    const state = await this.readState();
    delete state.apiKeys[origin];
    await this.writeState(state);
  }
}
