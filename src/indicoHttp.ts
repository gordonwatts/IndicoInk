import {
  createIndicoEventExportUrl,
  type IndicoEventIdentity,
} from './indicoEvent';

export class IndicoHttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: string | null = null,
  ) {
    super(message);
    this.name = 'IndicoHttpError';
  }
}

export class IndicoTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndicoTimeoutError';
  }
}

export class IndicoResponseSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndicoResponseSizeError';
  }
}

export class IndicoResponseParseError extends Error {
  constructor(
    message: string,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = 'IndicoResponseParseError';
  }
}

const authChallengePatterns = [
  /api key/i,
  /authentication required/i,
  /auth required/i,
  /log in/i,
  /login/i,
  /sign in/i,
  /private event/i,
  /authorization required/i,
];

const cloudflareChallengePatterns = [/just a moment/i, /cloudflare/i];

export const isLikelyIndicoApiKeyError = (
  statusCode: number,
  responseBody: string | null,
) => {
  if (statusCode === 401) {
    return true;
  }

  if (statusCode !== 403) {
    return false;
  }

  if (responseBody === null) {
    return true;
  }

  if (
    cloudflareChallengePatterns.some((pattern) => pattern.test(responseBody))
  ) {
    return false;
  }

  return authChallengePatterns.some((pattern) => pattern.test(responseBody));
};

export type IndicoJsonResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
};

export type FetchIndicoJsonOptions = {
  detail?: 'contributions' | 'sessions';
  timeoutMilliseconds?: number;
  maxBytes?: number;
  apiKey?: string;
  fetchImpl?: (
    input: string,
    init?: { signal?: AbortSignal },
  ) => Promise<IndicoJsonResponse>;
};

const defaultTimeoutMilliseconds = 15_000;
const defaultMaxBytes = 15_000_000;

const getByteLength = (value: string) => Buffer.byteLength(value, 'utf8');

const createTimeoutError = (url: string, timeoutMilliseconds: number) =>
  new IndicoTimeoutError(
    `Timed out fetching ${url} after ${timeoutMilliseconds} ms.`,
  );

export const fetchIndicoJson = async <T>(
  identity: IndicoEventIdentity,
  {
    detail = 'sessions',
    timeoutMilliseconds = defaultTimeoutMilliseconds,
    maxBytes = defaultMaxBytes,
    apiKey,
    fetchImpl = globalThis.fetch.bind(globalThis),
  }: FetchIndicoJsonOptions = {},
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  const url = new URL(createIndicoEventExportUrl(identity, detail));
  const requestUrl = url.toString();
  if (apiKey) {
    url.searchParams.set('ak', apiKey);
  }

  try {
    const response = await fetchImpl(requestUrl, { signal: controller.signal });

    if (!response.ok) {
      let responseBody: string | null = null;
      try {
        responseBody = await response.text();
      } catch {
        responseBody = null;
      }

      throw new IndicoHttpError(
        `Indico returned HTTP ${response.status} for ${requestUrl}.`,
        response.status,
        responseBody,
      );
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength && Number(declaredLength) > maxBytes) {
      throw new IndicoResponseSizeError(
        `Indico response exceeded the ${maxBytes} byte limit before reading ${requestUrl}.`,
      );
    }

    const body = await response.text();
    if (getByteLength(body) > maxBytes) {
      throw new IndicoResponseSizeError(
        `Indico response exceeded the ${maxBytes} byte limit for ${requestUrl}.`,
      );
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new IndicoResponseParseError(
        `Indico returned invalid JSON for ${requestUrl}.`,
        body,
      );
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw createTimeoutError(requestUrl, timeoutMilliseconds);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
