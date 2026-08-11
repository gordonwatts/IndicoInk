import type { PersistenceStore } from './persistenceStore';
import type { ImportedConferenceResult } from './shared/library';
import { persistImportedAgenda } from './agendaImportPersistence';
import { parseIndicoEventUrl } from './indicoEvent';
import {
  fetchIndicoJson,
  IndicoHttpError,
  type FetchIndicoJsonOptions,
} from './indicoHttp';
import {
  isEmptyIndicoExportEnvelope,
  mapIndicoExportEnvelope,
} from './indicoMapping';

export type ImportIndicoEventOptions = FetchIndicoJsonOptions;

export class IndicoEventImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndicoEventImportError';
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

  const raw = await fetchIndicoJson<unknown>(identity, options);
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
  return persistImportedAgenda(store, mapped);
};
