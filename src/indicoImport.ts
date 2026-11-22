import type { PersistenceStore } from './persistenceStore';
import type { ImportedConferenceResult } from './shared/library';
import { persistImportedAgenda } from './agendaImportPersistence';
import { parseIndicoEventUrl } from './indicoEvent';
import {
  fetchIndicoJson,
  IndicoHttpError,
  IndicoResponseParseError,
  type IndicoFetchProgressStage,
  type FetchIndicoJsonOptions,
} from './indicoHttp';
import {
  isEmptyIndicoExportEnvelope,
  isIndicoExportEnvelope,
  mapIndicoExportEnvelope,
} from './indicoMapping';

export type ImportIndicoEventOptions = FetchIndicoJsonOptions & {
  onProgress?: (stage: IndicoFetchProgressStage | 'saving-event') => void;
};

export class IndicoEventImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndicoEventImportError';
  }
}

export class NotIndicoEventError extends Error {
  constructor(
    message = 'This URL did not return a matching Indico event export.',
  ) {
    super(message);
    this.name = 'NotIndicoEventError';
  }
}

export const importIndicoEvent = async (
  store: PersistenceStore,
  eventUrl: string,
  options: ImportIndicoEventOptions = {},
): Promise<ImportedConferenceResult> => {
  const identity = parseIndicoEventUrl(eventUrl);
  if (!identity) {
    throw new IndicoEventImportError(
      'The provided URL is not a valid Indico event.',
    );
  }

  let raw: unknown;
  try {
    raw = await fetchIndicoJson<unknown>(identity, {
      ...options,
      ...(options.onProgress
        ? {
            onProgress: (stage: IndicoFetchProgressStage) =>
              options.onProgress?.(stage),
          }
        : {}),
    });
  } catch (error) {
    if (
      error instanceof IndicoResponseParseError ||
      (error instanceof IndicoHttpError &&
        [400, 404, 405].includes(error.statusCode))
    ) {
      throw new NotIndicoEventError();
    }
    throw error;
  }
  if (
    !isIndicoExportEnvelope(raw as { [key: string]: unknown }, identity.eventId)
  ) {
    throw new NotIndicoEventError();
  }
  if (
    isEmptyIndicoExportEnvelope(raw as { count?: unknown; results?: unknown })
  ) {
    throw new IndicoHttpError(
      `Indico returned no event data for ${identity.canonicalEventUrl}.`,
      403,
      'Indico returned no event data. This event may require an API key.',
    );
  }

  const mapped = mapIndicoExportEnvelope(
    raw as { results?: unknown },
    identity,
  );
  options.onProgress?.('saving-event');
  return persistImportedAgenda(store, mapped);
};
