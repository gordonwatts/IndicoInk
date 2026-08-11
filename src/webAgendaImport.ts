import { persistImportedAgenda } from './agendaImportPersistence';
import { reconcileMappedAgenda } from './indicoRefresh';
import type { PersistenceStore } from './persistenceStore';
import { createConferenceId } from './persistenceModels';
import type {
  ImportedConferenceResult,
  RefreshLibraryEventResult,
} from './shared/library';
import type { OpenAiConfiguration } from './shared/openAi';
import {
  extractWebAgenda,
  fetchNormalizedWebAgenda,
  getPriorWebAgendaTalks,
  mapExtractedWebAgenda,
  normalizeWebAgendaUrl,
  type WebAgendaFetch,
} from './webAgenda';

export type WebAgendaOperationOptions = {
  configuration: OpenAiConfiguration;
  apiKey: string;
  fetchImpl: WebAgendaFetch;
  onProgress?: (stage: WebAgendaProgressStage) => void;
};

export type WebAgendaProgressStage = 'fetching-webpage' | 'extracting-agenda';

export const importWebAgenda = async (
  store: PersistenceStore,
  sourceUrl: string,
  options: WebAgendaOperationOptions,
): Promise<ImportedConferenceResult> => {
  options.onProgress?.('fetching-webpage');
  const page = await fetchNormalizedWebAgenda(sourceUrl, options.fetchImpl);
  options.onProgress?.('extracting-agenda');
  const extracted = await extractWebAgenda(
    page,
    options.configuration,
    options.apiKey,
    [],
    options.fetchImpl,
  );
  const mapped = mapExtractedWebAgenda(page, extracted);
  return persistImportedAgenda(store, mapped);
};

export const refreshWebAgenda = async (
  store: PersistenceStore,
  sourceUrl: string,
  options: WebAgendaOperationOptions & { decision?: 'keep' | 'replace' },
): Promise<RefreshLibraryEventResult> => {
  const normalizedUrl = normalizeWebAgendaUrl(sourceUrl);
  const conferenceId = createConferenceId(normalizedUrl);
  const priorTalks = await getPriorWebAgendaTalks(store, conferenceId);
  options.onProgress?.('fetching-webpage');
  const page = await fetchNormalizedWebAgenda(normalizedUrl, options.fetchImpl);
  options.onProgress?.('extracting-agenda');
  const extracted = await extractWebAgenda(
    page,
    options.configuration,
    options.apiKey,
    priorTalks,
    options.fetchImpl,
  );
  const mapped = mapExtractedWebAgenda(page, extracted, priorTalks);
  return reconcileMappedAgenda(store, mapped, {
    ...(options.decision ? { decision: options.decision } : {}),
  });
};
