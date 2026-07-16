import type { Conference, Talk } from './persistenceModels';
import type { IndicoEventIdentity } from './indicoEvent';
import { sha1Hex } from './stableHash';

type IndicoDateValue = {
  date?: string;
  time?: string;
  tz?: string;
};

type IndicoPersonValue = {
  first_name?: string;
  last_name?: string;
  fullName?: string;
  affiliation?: string;
  id?: string;
};

type IndicoMaterialValue = {
  id?: string | number;
  title?: string;
  filename?: string;
  name?: string;
  url?: string;
  download_url?: string;
  mimetype?: string;
  content_type?: string;
  type?: string;
  selected?: boolean;
};

type IndicoFolderValue = {
  attachments?: IndicoMaterialValue[];
};

type IndicoContributionValue = {
  id?: string | number;
  friendly_id?: string | number;
  title?: string;
  description?: string;
  startDate?: IndicoDateValue;
  endDate?: IndicoDateValue;
  duration?: number;
  room?: string;
  roomFullname?: string;
  location?: string;
  session?:
    | string
    | { id?: string | number; title?: string; room?: string }
    | null;
  speakers?: IndicoPersonValue[];
  primaryauthors?: IndicoPersonValue[];
  coauthors?: IndicoPersonValue[];
  material?: IndicoMaterialValue[];
  folders?: IndicoFolderValue[];
  subContributions?: IndicoContributionValue[];
  url?: string;
};

type IndicoSessionValue = {
  id?: string | number;
  title?: string;
  startDate?: IndicoDateValue;
  endDate?: IndicoDateValue;
  room?: string;
  roomFullname?: string;
  location?: string;
  url?: string;
  contributions?: IndicoContributionValue[];
  material?: IndicoMaterialValue[];
  folders?: IndicoFolderValue[];
};

type IndicoEventValue = {
  id?: string | number;
  title?: string;
  description?: string;
  startDate?: IndicoDateValue;
  endDate?: IndicoDateValue;
  timezone?: string;
  room?: string;
  roomFullname?: string;
  location?: string;
  url?: string;
  category?: string;
  organizer?: string;
  keywords?: string[];
  material?: IndicoMaterialValue[];
  contributions?: IndicoContributionValue[];
  sessions?: IndicoSessionValue[];
};

type IndicoContributionSource = {
  contribution?: IndicoContributionValue;
  linkedAgenda?: IndicoSessionValue;
};

export type IndicoHierarchySession = {
  title: string;
  room: string;
  startAt: number | null;
  endAt: number | null;
  contributionIds: string[];
};

export type IndicoHierarchyDay = {
  key: string;
  label: string;
  sessions: IndicoHierarchySession[];
};

export type IndicoSpeakerEntity = {
  contributionId: string;
  name: string;
  affiliation: string;
};

export type IndicoMaterialEntity = {
  id: string;
  contributionId: string;
  title: string;
  url: string;
  mimeType: string;
  selected: boolean;
  kind: 'pdf' | 'other';
};

export type IndicoTalkEntity = Omit<
  Talk,
  'id' | 'conferenceId' | 'createdAt' | 'updatedAt'
> & {
  contributionUrl: string;
  speakers: IndicoSpeakerEntity[];
  materials: IndicoMaterialEntity[];
};

export type IndicoImportData = {
  conference: Conference;
  hierarchy: IndicoHierarchyDay[];
  talks: IndicoTalkEntity[];
  speakers: IndicoSpeakerEntity[];
  materials: IndicoMaterialEntity[];
};

type RawEnvelope = {
  count?: unknown;
  results?: unknown;
};

const getString = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const getNumberLike = (value: unknown) =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : '';

const asArray = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const pickFirstResult = (envelope: RawEnvelope): IndicoEventValue | null => {
  const results = envelope.results;

  if (Array.isArray(results)) {
    return (results[0] as IndicoEventValue | undefined) ?? null;
  }

  if (results && typeof results === 'object') {
    const firstValue = Object.values(results as Record<string, unknown>)[0];
    if (firstValue && typeof firstValue === 'object') {
      return firstValue as IndicoEventValue;
    }
  }

  return null;
};

export const isEmptyIndicoExportEnvelope = (envelope: RawEnvelope) =>
  envelope.count === 0 &&
  Array.isArray(envelope.results) &&
  envelope.results.length === 0;

const parseDateTime = (value?: IndicoDateValue | null) => {
  if (!value?.date) {
    return null;
  }

  const [yearText, monthText, dayText] = value.date.split('-');
  if (!yearText || !monthText || !dayText) {
    return null;
  }

  const timeParts = value.time?.split(':') ?? [];
  const hours = Number(timeParts[0] ?? 0);
  const minutes = Number(timeParts[1] ?? 0);
  const seconds = Number(timeParts[2] ?? 0);

  return Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    Number.isFinite(seconds) ? seconds : 0,
    0,
  );
};

const formatDate = (dateValue?: IndicoDateValue | null) => {
  if (!dateValue?.date) {
    return null;
  }

  const [yearText, monthText, dayText] = dateValue.date.split('-');
  if (!yearText || !monthText || !dayText) {
    return null;
  }

  const date = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)),
  );
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
};

const formatDateRange = (
  startDate?: IndicoDateValue | null,
  endDate?: IndicoDateValue | null,
) => {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  if (!start && !end) {
    return 'Date unavailable';
  }

  if (!start || !end || start === end) {
    return start ?? end ?? 'Date unavailable';
  }

  return `${start} - ${end}`;
};

const getSpeakerName = (speaker: IndicoPersonValue) =>
  getString(speaker.fullName) ||
  [getString(speaker.first_name), getString(speaker.last_name)]
    .filter(Boolean)
    .join(' ')
    .trim();

const getMaterialTitle = (
  material: IndicoMaterialValue,
  fallbackIndex: number,
) =>
  getString(material.title) ||
  getString(material.filename) ||
  getString(material.name) ||
  `Material ${fallbackIndex + 1}`;

const getMaterialUrl = (material: IndicoMaterialValue) =>
  getString(material.url) || getString(material.download_url);

const getMaterialMimeType = (material: IndicoMaterialValue) =>
  getString(material.mimetype) ||
  getString(material.content_type) ||
  (getString(material.type) === 'pdf'
    ? 'application/pdf'
    : 'application/octet-stream');

const collectMaterials = (
  material: IndicoMaterialValue[] | undefined,
  folders: IndicoFolderValue[] | undefined,
) => [
  ...asArray<IndicoMaterialValue>(material),
  ...asArray<IndicoFolderValue>(folders).flatMap((folder) =>
    asArray<IndicoMaterialValue>(folder.attachments),
  ),
];

const createMaterialId = (
  contributionId: string,
  url: string,
  title: string,
  index: number,
) =>
  `material_${sha1Hex(`${contributionId}:${url}:${title}:${index}`).slice(
    0,
    20,
  )}`;

const getContributionId = (
  contribution: IndicoContributionValue,
  index: number,
) =>
  getNumberLike(contribution.friendly_id) ||
  getNumberLike(contribution.id) ||
  `contribution-${index + 1}`;

const getContributionTitle = (
  contribution: IndicoContributionValue,
  index: number,
) => getString(contribution.title) || `Untitled contribution ${index + 1}`;

const getContributionUrl = (
  identity: IndicoEventIdentity,
  contribution: IndicoContributionValue,
  contributionId: string,
) =>
  getString(contribution.url) ||
  `${identity.canonicalEventUrl}/contributions/${encodeURIComponent(contributionId)}/`;

const getContributionSessionTitle = (
  contribution: IndicoContributionValue,
  fallback = 'Unscheduled',
) => {
  if (typeof contribution.session === 'string') {
    return getString(contribution.session, fallback);
  }

  if (contribution.session && typeof contribution.session === 'object') {
    return getString(contribution.session.title, fallback);
  }

  return fallback;
};

const collectNestedContributions = (
  contributions: IndicoContributionValue[] | undefined,
): IndicoContributionValue[] =>
  contributions?.flatMap((contribution) => [
    contribution,
    ...collectNestedContributions(contribution.subContributions),
  ]) ?? [];

const createSessionFallbackContribution = (
  session: IndicoSessionValue,
  contribution: IndicoContributionValue,
): IndicoContributionValue => {
  const next: IndicoContributionValue = { ...contribution };

  if (contribution.session == null) {
    next.session = {
      title: getString(session.title, 'Unscheduled'),
      room:
        getString(session.roomFullname) ||
        getString(session.room) ||
        getString(session.location) ||
        'Room unavailable',
    };
  }

  if (contribution.roomFullname === undefined && session.roomFullname) {
    next.roomFullname = session.roomFullname;
  }

  if (contribution.room === undefined && session.room) {
    next.room = session.room;
  }

  if (contribution.location === undefined && session.location) {
    next.location = session.location;
  }

  return next;
};

const collectContributionSources = (
  event: IndicoEventValue,
): IndicoContributionSource[] => {
  const sessionSources = asArray<IndicoSessionValue>(event.sessions).flatMap(
    (session) =>
      collectNestedContributions(session.contributions).map((contribution) => ({
        contribution: createSessionFallbackContribution(session, contribution),
      })),
  );

  const contributions = collectNestedContributions(event.contributions);
  const contributionSources = contributions.map((contribution) => ({
    contribution,
  }));
  const linkedAgendaSources = asArray<IndicoSessionValue>(event.sessions)
    .filter(
      (session) =>
        collectNestedContributions(session.contributions).length === 0,
    )
    .map((linkedAgenda) => ({ linkedAgenda }));
  return [...sessionSources, ...contributionSources, ...linkedAgendaSources];
};

const createHierarchyBucket = (
  map: Map<string, IndicoHierarchyDay>,
  dayKey: string,
  dayLabel: string,
) => {
  const existing = map.get(dayKey);
  if (existing) {
    return existing;
  }

  const next = { key: dayKey, label: dayLabel, sessions: [] };
  map.set(dayKey, next);
  return next;
};

const mapMaterial = (
  contributionId: string,
  material: IndicoMaterialValue,
  index: number,
): IndicoMaterialEntity | null => {
  const url = getMaterialUrl(material);
  if (!url) {
    return null;
  }

  const title = getMaterialTitle(material, index);
  const mimeType = getMaterialMimeType(material);
  return {
    id: createMaterialId(contributionId, url, title, index),
    contributionId,
    title,
    url,
    mimeType,
    selected: Boolean(material.selected),
    kind:
      mimeType.includes('pdf') || url.toLowerCase().endsWith('.pdf')
        ? 'pdf'
        : 'other',
  };
};

const mapContribution = (
  identity: IndicoEventIdentity,
  contribution: IndicoContributionValue,
  index: number,
) => {
  const contributionId = getContributionId(contribution, index);
  const speakerEntities = asArray<IndicoPersonValue>(contribution.speakers).map(
    (speaker) => ({
      contributionId,
      name: getSpeakerName(speaker),
      affiliation: getString(speaker.affiliation),
    }),
  );
  const speakers = speakerEntities
    .map((speaker) => speaker.name)
    .filter(Boolean);
  const materials = collectMaterials(
    contribution.material,
    contribution.folders,
  )
    .map((material, materialIndex) =>
      mapMaterial(contributionId, material, materialIndex),
    )
    .filter((material): material is IndicoMaterialEntity => Boolean(material));

  return {
    contributionId,
    title: getContributionTitle(contribution, index),
    speaker: speakers.join('; '),
    speakers: speakerEntities,
    sessionTitle: getContributionSessionTitle(contribution),
    startsAt: parseDateTime(contribution.startDate),
    endsAt: parseDateTime(contribution.endDate),
    room:
      getString(contribution.roomFullname) ||
      getString(contribution.room) ||
      getString(contribution.location) ||
      'Room unavailable',
    contributionUrl: getContributionUrl(identity, contribution, contributionId),
    materials,
    bookmarked: false,
    entryKind: 'talk' as const,
    linkedAgendaUrl: '',
  };
};

const mapLinkedAgenda = (session: IndicoSessionValue, index: number) => {
  const contributionId =
    getNumberLike(session.id) || `linked-agenda-${index + 1}`;
  return {
    contributionId,
    title: getString(session.title, 'Linked agenda'),
    speaker: '',
    speakers: [],
    sessionTitle: getString(session.title, 'Linked agenda'),
    startsAt: parseDateTime(session.startDate),
    endsAt: parseDateTime(session.endDate),
    room:
      getString(session.roomFullname) ||
      getString(session.room) ||
      getString(session.location) ||
      'Room unavailable',
    contributionUrl: getString(session.url),
    materials: [],
    bookmarked: false,
    entryKind: 'linked-agenda' as const,
    linkedAgendaUrl: getString(session.url),
  };
};

export const mapIndicoExportEnvelope = (
  envelope: RawEnvelope,
  identity: IndicoEventIdentity,
): IndicoImportData => {
  const event = pickFirstResult(envelope);
  const eventTitle = getString(event?.title, 'Untitled Indico event');
  const sessions = asArray<IndicoSessionValue>(event?.sessions);
  const contributionSources = collectContributionSources(event ?? {});
  const talks = contributionSources.map((source, index) =>
    source.linkedAgenda
      ? mapLinkedAgenda(source.linkedAgenda, index)
      : mapContribution(identity, source.contribution!, index),
  );

  const talkByContributionId = new Map(
    talks.map((talk) => [talk.contributionId, talk] as const),
  );

  const hierarchyByDay = new Map<string, IndicoHierarchyDay>();

  for (const source of contributionSources) {
    if (!source.contribution) {
      const linkedAgenda = source.linkedAgenda!;
      const contributionId =
        getNumberLike(linkedAgenda.id) ||
        `linked-agenda-${contributionSources.indexOf(source) + 1}`;
      const dateKey =
        linkedAgenda.startDate?.date ?? event?.startDate?.date ?? 'unknown';
      const dayLabel =
        formatDate(linkedAgenda.startDate) ??
        formatDate(event?.startDate) ??
        'Date unavailable';
      const day = createHierarchyBucket(hierarchyByDay, dateKey, dayLabel);
      day.sessions.push({
        title: getString(linkedAgenda.title, 'Linked agenda'),
        room:
          getString(linkedAgenda.roomFullname) ||
          getString(linkedAgenda.room) ||
          getString(linkedAgenda.location) ||
          'Room unavailable',
        startAt: parseDateTime(linkedAgenda.startDate),
        endAt: parseDateTime(linkedAgenda.endDate),
        contributionIds: [contributionId],
      });
      continue;
    }
    const contribution = source.contribution;
    const contributionId =
      getNumberLike(contribution.friendly_id) || getNumberLike(contribution.id);
    const startsAt = parseDateTime(contribution.startDate);
    const dateKey = contribution.startDate?.date ?? 'unknown';
    const dayLabel =
      formatDate(contribution.startDate) ??
      formatDate(event?.startDate) ??
      'Date unavailable';
    const day = createHierarchyBucket(hierarchyByDay, dateKey, dayLabel);
    const sessionTitle = getContributionSessionTitle(contribution);
    const existingSession = day.sessions.find(
      (session) => session.title === sessionTitle,
    );
    const sessionRoom =
      getString(contribution.roomFullname) ||
      getString(contribution.room) ||
      getString(contribution.location) ||
      'Room unavailable';

    const session = existingSession ?? {
      title: sessionTitle,
      room: sessionRoom,
      startAt: startsAt,
      endAt: parseDateTime(contribution.endDate),
      contributionIds: [],
    };

    if (!existingSession) {
      day.sessions.push(session);
    }

    if (!session.contributionIds.includes(contributionId)) {
      session.contributionIds.push(contributionId);
    }

    if (
      session.startAt === null ||
      (startsAt !== null && startsAt < session.startAt)
    ) {
      session.startAt = startsAt;
    }
    const endsAt = parseDateTime(contribution.endDate);
    if (session.endAt === null || (endsAt !== null && endsAt > session.endAt)) {
      session.endAt = endsAt;
    }
  }

  if (
    hierarchyByDay.size === 0 &&
    sessions.length > 0 &&
    contributionSources.length === 0
  ) {
    for (const session of sessions) {
      const sessionDateKey =
        session.startDate?.date ?? event?.startDate?.date ?? 'unknown';
      const dayLabel =
        formatDate(session.startDate) ??
        formatDate(event?.startDate) ??
        'Date unavailable';
      const day = createHierarchyBucket(
        hierarchyByDay,
        sessionDateKey,
        dayLabel,
      );
      day.sessions.push({
        title: getString(session.title, 'Untitled session'),
        room:
          getString(session.roomFullname) ||
          getString(session.room) ||
          getString(session.location) ||
          'Room unavailable',
        startAt: parseDateTime(session.startDate),
        endAt: parseDateTime(session.endDate),
        contributionIds: [],
      });
    }
  }

  const allMaterials = talks.flatMap((talk) => talk.materials);
  const allSpeakers = talks.flatMap((talk) => talk.speakers);

  const conference: Conference = {
    id: identity.conferenceId,
    sourceUrl: identity.canonicalEventUrl,
    title: eventTitle,
    dates: formatDateRange(event?.startDate, event?.endDate),
    host: identity.origin.replace(/^https?:\/\//, ''),
    lastOpenedAt: null,
    createdAt: 0,
    updatedAt: 0,
  };

  return {
    conference,
    hierarchy: [...hierarchyByDay.values()].sort((left, right) =>
      left.key.localeCompare(right.key),
    ),
    talks: talks.map((talk) => ({
      ...talk,
      bookmarked: Boolean(
        talkByContributionId.get(talk.contributionId)?.bookmarked,
      ),
    })),
    speakers: allSpeakers,
    materials: allMaterials,
  };
};
