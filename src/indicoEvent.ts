import { createConferenceId } from './persistenceModels';

const eventPathPattern = /^\/event\/([^/?#]+)(?:\/.*)?$/;
const eventOpenPathPattern =
  /^\/event\/[^/?#]+(?:\/timetable(?:\/[^/?#]*)?)?\/?$/;
const eventSessionPathPattern =
  /^\/event\/[^/?#]+\/sessions\/[^/?#]+(?:\/.*)?$/;

const isTrustedIndicoHostname = (hostname: string) =>
  hostname === 'indico.global' ||
  hostname === 'indico' ||
  hostname.startsWith('indico.') ||
  hostname.includes('.indico.');

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export type IndicoEventIdentity = {
  eventId: string;
  origin: string;
  canonicalEventUrl: string;
  conferenceId: string;
};

export const parseIndicoEventUrl = (
  value: string,
): IndicoEventIdentity | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') {
    return null;
  }

  if (!isTrustedIndicoHostname(url.hostname)) {
    return null;
  }

  const match = url.pathname.match(eventPathPattern);
  if (!match) {
    return null;
  }

  const eventId = decodeURIComponent(match[1] ?? '').trim();
  if (!eventId) {
    return null;
  }

  const canonicalEventUrl = stripTrailingSlash(
    `${url.origin}/event/${encodeURIComponent(eventId)}`,
  );

  return {
    eventId,
    origin: url.origin,
    canonicalEventUrl,
    conferenceId: createConferenceId(canonicalEventUrl),
  };
};

export const parseIndicoEventLinkUrl = (value: string) => {
  const identity = parseIndicoEventUrl(value);
  if (!identity) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  return eventOpenPathPattern.test(url.pathname) ? identity : null;
};

export const parseIndicoEventSessionUrl = (value: string) => {
  const identity = parseIndicoEventUrl(value);
  if (!identity) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  return eventSessionPathPattern.test(url.pathname) ? identity : null;
};

export const createIndicoEventExportUrl = (
  identity: IndicoEventIdentity,
  detail: 'contributions' | 'sessions' = 'sessions',
) =>
  `${identity.origin}/export/event/${encodeURIComponent(
    identity.eventId,
  )}.json?detail=${detail}&pretty=yes`;
