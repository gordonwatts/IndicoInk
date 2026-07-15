import {
  getIndicoApiKeyPromptMessage,
  IndicoHttpError,
  isLikelyIndicoApiKeyError,
} from './indicoHttp';
import type { IndicoEventIdentity } from './indicoEvent';
import type { RefreshLibraryEventResult } from './shared/library';

export const classifyRefreshError = (
  error: unknown,
  identity: IndicoEventIdentity,
): Extract<RefreshLibraryEventResult, { kind: 'api-key-required' }> | null => {
  if (
    !(error instanceof IndicoHttpError) ||
    !isLikelyIndicoApiKeyError(error.statusCode, error.responseBody)
  ) {
    return null;
  }

  return {
    kind: 'api-key-required',
    conferenceId: identity.conferenceId,
    origin: identity.origin,
    message: getIndicoApiKeyPromptMessage(
      error.statusCode,
      error.responseBody,
    ),
  };
};
