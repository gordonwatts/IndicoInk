import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SyncWorkerCore } from './syncWorkerCore';
import { canonicalJson } from './syncProtocol';

const roots: string[] = [];
const deviceId = '72fc257a-40d2-4b19-ae71-b2a02f4fe5e6';
const createRoot = async () => {
  const path = await mkdtemp(join(process.cwd(), '.sync-worker-test-'));
  roots.push(path);
  return path;
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('sync utility worker filesystem boundary', () => {
  it('publishes immutable files atomically and treats identical retries as success', async () => {
    const root = await createRoot();
    const worker = new SyncWorkerCore();
    await worker.initialize(root, deviceId);
    const path = 'conferences/event/metadata/ops/device/0/1-op.json';
    const bytes = Buffer.from('{"format":"test"}');

    try {
      await worker.publishImmutable(path, bytes);
    } catch (error) {
      if (/atomic no-clobber publication \(EPERM\)/.test(String(error))) {
        // Restricted Windows runners forbid hard links; failing closed is required.
        return;
      }
      throw error;
    }
    await expect(worker.publishImmutable(path, bytes)).resolves.toMatchObject({
      published: true,
    });
    expect(await readFile(join(root, ...path.split('/')))).toEqual(bytes);
    await expect(
      worker.publishImmutable(path, Buffer.from('{"format":"other"}')),
    ).rejects.toThrow(/different bytes/);
  });

  it('rejects traversal, oversized reads, symlinked parents, and pause-time I/O', async () => {
    const root = await createRoot();
    const outside = await createRoot();
    const worker = new SyncWorkerCore();
    await worker.initialize(root, deviceId);
    await expect(worker.readFile('../outside.json')).rejects.toThrow(/unsafe/);
    await mkdir(join(root, 'records'));
    await writeFile(join(root, 'records', 'large.json'), Buffer.alloc(20));
    await expect(worker.readFile('records/large.json', 10)).rejects.toThrow(
      /byte limit/,
    );

    try {
      await symlink(outside, join(root, 'linked'), 'junction');
      await expect(worker.readFile('linked/secret.json')).rejects.toThrow(
        /links|normal directory/,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
        throw error;
      }
    }

    worker.pause();
    await expect(worker.readFile('records/large.json')).rejects.toThrow(
      /paused/,
    );
  });

  it('pages sorted bounded directory entries with a resumable filename cursor', async () => {
    const root = await createRoot();
    const worker = new SyncWorkerCore();
    await worker.initialize(root, deviceId);
    await mkdir(join(root, 'bucket'));
    for (const name of ['b.json', 'a.json', 'c.json']) {
      await writeFile(join(root, 'bucket', name), Buffer.from(name));
    }

    let first = await worker.enumerateDirectory(
      { relativeDirectory: 'bucket', lastName: null },
      { maxDirectoryEntries: 2 },
    );
    if (first.entries.length === 0 && first.partial) {
      first = await worker.enumerateDirectory(first.nextCursor!, {
        maxDirectoryEntries: 2,
      });
    }
    expect(first.entries.map(({ name }) => name)).toEqual(['a.json', 'b.json']);
    expect(first.partial).toBe(true);
    expect(first.nextCursor).toEqual({
      relativeDirectory: 'bucket',
      lastName: 'b.json',
    });

    const second = await worker.enumerateDirectory(first.nextCursor!, {
      maxDirectoryEntries: 2,
    });
    expect(second.entries.map(({ name }) => name)).toEqual(['c.json']);
    expect(second.nextCursor).toBeNull();

    await unlink(join(root, 'bucket', 'b.json'));
    const afterDeletion = await worker.enumerateDirectory(first.nextCursor!, {
      maxDirectoryEntries: 2,
    });
    expect(afterDeletion.entries.map(({ name }) => name)).toEqual(['c.json']);
  });

  it('continues through directories larger than one scan page', async () => {
    const root = await createRoot();
    const worker = new SyncWorkerCore();
    await worker.initialize(root, deviceId);
    await mkdir(join(root, 'conferences'));
    for (let index = 0; index < 1001; index += 1) {
      await writeFile(
        join(
          root,
          'conferences',
          `conference-${String(index).padStart(4, '0')}`,
        ),
        Buffer.alloc(0),
      );
    }

    const indexingPage = await worker.enumerateDirectory(
      { relativeDirectory: 'conferences', lastName: null },
      { maxDirectoryEntries: 1000 },
    );
    expect(indexingPage.entries).toHaveLength(0);
    expect(indexingPage.examined).toBe(1000);
    expect(indexingPage.partial).toBe(true);
    await worker.initialize(root, deviceId);
    const first = await worker.enumerateDirectory(indexingPage.nextCursor!, {
      maxDirectoryEntries: 1000,
    });
    expect(first.entries).toHaveLength(1000);
    expect(first.partial).toBe(true);
    const second = await worker.enumerateDirectory(first.nextCursor!, {
      maxDirectoryEntries: 1000,
    });
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]?.name).toBe('conference-1000');
    expect(second.partial).toBe(false);
  });

  it('atomically replaces only a device catalog', async () => {
    const root = await createRoot();
    const worker = new SyncWorkerCore();
    await worker.initialize(root, deviceId);
    const path = `devices/${deviceId}/catalog.json`;
    const catalog = (generation: number) =>
      Buffer.from(
        canonicalJson({
          format: 'indicoink-catalog',
          version: 1,
          workspaceId: '198b32f0-ad33-4796-b9e3-b36488027d7a',
          deviceId,
          generation,
          updatedAt: 0,
          conferences: [],
        }),
      );
    try {
      await worker.replaceCatalog(path, catalog(1));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        return;
      }
      throw error;
    }
    await worker.replaceCatalog(path, catalog(2));
    await expect(
      readFile(join(root, ...path.split('/')), 'utf8'),
    ).resolves.toBe(catalog(2).toString());
    await expect(
      worker.replaceCatalog(path, catalog(2)),
    ).resolves.toMatchObject({ replaced: false });
    await expect(
      worker.replaceCatalog(
        'devices/639be5ee-82ea-4a08-93a9-afc608990bdc/acks/catalog.json',
        Buffer.from('{}'),
      ),
    ).rejects.toThrow(/Only a device catalog/);
  });
});
