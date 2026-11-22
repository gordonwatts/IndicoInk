import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

type TestRequest = {
  requestId: string;
  command: string;
  payload: Record<string, unknown>;
};

class TestChild extends EventEmitter {
  readonly requests: TestRequest[] = [];

  postMessage(request: TestRequest) {
    this.requests.push(request);
    queueMicrotask(() => {
      this.emit('message', {
        requestId: request.requestId,
        ok: true,
        result:
          request.command === 'initialize' ? { ready: true } : { paused: true },
      });
    });
  }

  kill() {
    this.emit('exit', 0);
  }
}

const children: TestChild[] = [];
vi.mock('electron', () => ({
  utilityProcess: {
    fork: () => {
      const child = new TestChild();
      children.push(child);
      return child;
    },
  },
}));

import { SyncWorkerClient } from './syncWorkerClient';

describe('sync worker client lifecycle', () => {
  it('restores the folder identity before commands after a process exit', async () => {
    children.length = 0;
    const client = new SyncWorkerClient();
    await client.initialize('C:\\sync', '72fc257a-40d2-4b19-ae71-b2a02f4fe5e6');
    await client.pause();
    expect(children[0]?.requests.map(({ command }) => command)).toEqual([
      'initialize',
    ]);
    await expect(client.readFile('record.json')).rejects.toThrow(/paused/);

    await client.resume();
    expect(children[1]?.requests.map(({ command }) => command)).toEqual([
      'initialize',
      'resume',
    ]);

    children[1]?.emit('exit', 1);
    await client.resume();
    expect(children[2]?.requests.map(({ command }) => command)).toEqual([
      'initialize',
      'resume',
    ]);
    expect(children[2]?.requests[0]?.payload).toEqual({
      rootPath: 'C:\\sync',
      deviceId: '72fc257a-40d2-4b19-ae71-b2a02f4fe5e6',
    });
    client.close();
  });
});
