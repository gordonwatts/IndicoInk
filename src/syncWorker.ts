import { SyncWorkerCore, serializeWorkerResult } from './syncWorkerCore';

type WorkerRequest = {
  requestId: string;
  command:
    | 'initialize'
    | 'beginScan'
    | 'pause'
    | 'resume'
    | 'publish'
    | 'replaceCatalog'
    | 'read'
    | 'enumerate';
  payload: Record<string, unknown>;
};

const core = new SyncWorkerCore();
const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error('Sync utility process requires an Electron parent port.');
}

parentPort.on('message', async (event) => {
  const request = event.data as WorkerRequest;
  if (
    !request ||
    typeof request.requestId !== 'string' ||
    typeof request.command !== 'string' ||
    !request.payload ||
    typeof request.payload !== 'object'
  ) {
    return;
  }
  try {
    let result: unknown;
    let binary: Uint8Array | undefined;
    switch (request.command) {
      case 'initialize':
        result = await core.initialize(
          String(request.payload.rootPath ?? ''),
          String(request.payload.deviceId ?? ''),
        );
        break;
      case 'beginScan':
        result = core.beginScan();
        break;
      case 'pause':
        result = core.pause();
        break;
      case 'resume':
        result = core.resume();
        break;
      case 'publish':
        result = await core.publishImmutable(
          String(request.payload.relativePath ?? ''),
          request.payload.bytes as Uint8Array,
        );
        break;
      case 'replaceCatalog':
        result = await core.replaceCatalog(
          String(request.payload.relativePath ?? ''),
          request.payload.bytes as Uint8Array,
        );
        break;
      case 'read': {
        const bytes = await core.readFile(
          String(request.payload.relativePath ?? ''),
          Number(request.payload.maxBytes ?? 2 * 1024 * 1024),
        );
        result = { byteLength: bytes.byteLength };
        binary = bytes;
        break;
      }
      case 'enumerate':
        result = await core.enumerateDirectory(
          request.payload.cursor as {
            relativeDirectory: string;
            lastName: string | null;
          },
          request.payload.limits as Record<string, number> | undefined,
        );
        break;
      default:
        throw new Error('Unsupported sync worker command.');
    }
    parentPort.postMessage({
      requestId: request.requestId,
      ok: true,
      result: serializeWorkerResult(result),
      ...(binary ? { binary } : {}),
    });
  } catch (error) {
    parentPort.postMessage({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : 'Sync worker failed.',
    });
  }
});
