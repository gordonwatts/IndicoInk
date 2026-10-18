import { createHash } from 'node:crypto';
import {
  createConferenceId,
  createDeckId,
  createTalkId,
} from './persistenceModels';

export type SyncVector = Record<string, number>;

export type SyncOperation = {
  format: 'indicoink-operation';
  version: 1;
  workspaceId: string;
  streamId: string;
  deviceId: string;
  sequence: number;
  operationId: string;
  context: SyncVector;
  requires: Array<{ streamId: string; frontier: SyncVector }>;
  kind: string;
  payload: Record<string, unknown>;
  integrity: { byteLength: number; sha256: string };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PATH_COMPONENT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function fail(message: string): never {
  throw new Error(`Invalid sync record: ${message}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`expected fields ${expected.join(', ')}`);
  }
};

const isSafeInteger = (value: unknown, minimum = 0): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isSafePathComponent = (value: unknown): value is string =>
  typeof value === 'string' && PATH_COMPONENT_PATTERN.test(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const codePointCompare = (left: string, right: string) => {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) {
      return a[index]! - b[index]!;
    }
  }
  return a.length - b.length;
};

const canonicalValue = (value: unknown): string => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail('non-finite numbers and negative zero are unsupported');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        fail('JSON arrays cannot contain holes');
      }
      items.push(canonicalValue(value[index]));
    }
    return `[${items.join(',')}]`;
  }
  if (!isRecord(value)) {
    fail('value is not JSON data');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('JSON objects must be plain records');
  }
  const keys = Object.keys(value).sort(codePointCompare);
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
    .join(',')}}`;
};

export const canonicalJson = (value: unknown) => canonicalValue(value);

export const parseStrictSyncJson = (
  input: Uint8Array,
  options: {
    maxBytes?: number;
    maxDepth?: number;
    requireCanonical?: boolean;
  } = {},
) => {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxDepth = options.maxDepth ?? 32;
  if (!isSafeInteger(maxBytes, 1) || !isSafeInteger(maxDepth, 1)) {
    fail('JSON limits must be positive safe integers');
  }
  if (input.byteLength > maxBytes) {
    fail(`JSON file exceeds ${maxBytes} bytes`);
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    fail('JSON file is not valid UTF-8');
  }

  let index = 0;
  const skipWhitespace = () => {
    while (
      index < source.length &&
      ['\u0009', '\u000a', '\u000d', '\u0020'].includes(source[index]!)
    ) {
      index += 1;
    }
  };
  const parseString = () => {
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index]!;
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index)) as string;
        } catch {
          fail('JSON string has an invalid escape');
        }
      }
      if (character === '\\') {
        index += 2;
      } else {
        if (character < ' ') {
          fail('JSON string contains an unescaped control character');
        }
        index += 1;
      }
    }
    return fail('JSON string is unterminated');
  };
  const parseValue = (depth: number): unknown => {
    skipWhitespace();
    const character = source[index];
    if (character === '"') {
      return parseString();
    }
    if (character === '{' || character === '[') {
      if (depth >= maxDepth) {
        fail(`JSON nesting exceeds ${maxDepth}`);
      }
      index += 1;
      skipWhitespace();
      if (character === '{') {
        const result: Record<string, unknown> = Object.create(null) as Record<
          string,
          unknown
        >;
        if (source[index] === '}') {
          index += 1;
          return result;
        }
        while (index < source.length) {
          skipWhitespace();
          if (source[index] !== '"') {
            fail('JSON object key must be a string');
          }
          const key = parseString();
          if (Object.hasOwn(result, key)) {
            fail(`JSON object has duplicate key ${JSON.stringify(key)}`);
          }
          skipWhitespace();
          if (source[index] !== ':') {
            fail('JSON object key is missing a colon');
          }
          index += 1;
          result[key] = parseValue(depth + 1);
          skipWhitespace();
          if (source[index] === '}') {
            index += 1;
            return result;
          }
          if (source[index] !== ',') {
            fail('JSON object is missing a comma');
          }
          index += 1;
        }
        return fail('JSON object is unterminated');
      }
      const result: unknown[] = [];
      if (source[index] === ']') {
        index += 1;
        return result;
      }
      while (index < source.length) {
        result.push(parseValue(depth + 1));
        skipWhitespace();
        if (source[index] === ']') {
          index += 1;
          return result;
        }
        if (source[index] !== ',') {
          fail('JSON array is missing a comma');
        }
        index += 1;
      }
      return fail('JSON array is unterminated');
    }
    if (source.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (source.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (source.startsWith('null', index)) {
      index += 4;
      return null;
    }
    const number = source
      .slice(index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) {
      index += number[0].length;
      const parsed = Number(number[0]);
      if (!Number.isFinite(parsed) || Object.is(parsed, -0)) {
        fail('JSON numbers must be finite and cannot be negative zero');
      }
      return parsed;
    }
    return fail('JSON value is malformed');
  };

  const value = parseValue(0);
  skipWhitespace();
  if (index !== source.length) {
    fail('JSON has trailing data');
  }
  if (
    options.requireCanonical !== false &&
    !Buffer.from(canonicalJson(value), 'utf8').equals(Buffer.from(input))
  ) {
    fail('JSON bytes are not canonical');
  }
  return value;
};

export const sha256Hex = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');

export const encodeStreamKey = (streamId: string) => {
  const bytes = Buffer.from(streamId, 'utf8');
  if (bytes.length < 1 || bytes.length > 180) {
    fail('stream ID must encode to 1–180 UTF-8 bytes');
  }
  const key = bytes.toString('base64url');
  if (key.length > 240) {
    fail('stream key exceeds 240 path characters');
  }
  return key;
};

export const decodeStreamKey = (key: string) => {
  if (!/^[A-Za-z0-9_-]{2,240}$/.test(key)) {
    fail('stream key is not unpadded base64url');
  }
  const bytes = Buffer.from(key, 'base64url');
  const streamId = bytes.toString('utf8');
  if (
    bytes.length < 1 ||
    bytes.length > 180 ||
    !Buffer.from(streamId, 'utf8').equals(bytes) ||
    encodeStreamKey(streamId) !== key
  ) {
    fail('stream key does not round-trip canonically');
  }
  return streamId;
};

export const operationBucket = (sequence: number) => {
  if (!isSafeInteger(sequence, 1)) {
    fail('operation sequence must be a positive safe integer');
  }
  return Math.floor((sequence - 1) / 512).toString(10);
};

export const operationPath = (
  operation: Pick<
    SyncOperation,
    'streamId' | 'deviceId' | 'sequence' | 'operationId'
  >,
  conferenceId: string,
) => {
  const [scope, entityId, extra] = operation.streamId.split(':');
  if (
    extra !== undefined ||
    !isSafePathComponent(entityId) ||
    !isSafePathComponent(conferenceId)
  ) {
    fail('stream ID has an unsafe or unsupported entity component');
  }
  const deviceId = operation.deviceId;
  if (!isUuid(deviceId) || !isUuid(operation.operationId)) {
    fail('device and operation IDs must be canonical UUIDs');
  }
  const root = `conferences/${conferenceId}`;
  const prefix =
    scope === 'metadata'
      ? `${root}/metadata`
      : scope === 'deck'
        ? `${root}/decks/${entityId}`
        : null;
  if (!prefix) {
    fail('unsupported stream ID');
  }
  if (scope === 'metadata' && entityId !== conferenceId) {
    fail('metadata stream does not match conference path');
  }
  return `${prefix}/ops/${deviceId}/${operationBucket(operation.sequence)}/${operation.sequence}-${operation.operationId}.json`;
};

export const validateOperationLocation = (
  relativePath: string,
  operation: SyncOperation,
) => {
  const match = /^conferences\/([A-Za-z0-9_-]{1,128})\//.exec(relativePath);
  if (!match || relativePath !== operationPath(operation, match[1]!)) {
    fail('operation path does not match its identity fields');
  }
  if (operation.kind === 'annotation.put') {
    const annotation = operation.payload.annotation;
    if (!isRecord(annotation) || annotation.conferenceId !== match[1]) {
      fail('annotation conference does not match its path');
    }
  }
};

const validateVector = (value: unknown, field: string): SyncVector => {
  if (!isRecord(value)) {
    fail(`${field} must be a vector object`);
  }
  for (const [deviceId, sequence] of Object.entries(value)) {
    if (!isUuid(deviceId) || !isSafeInteger(sequence, 1)) {
      fail(`${field} contains an invalid device or sequence`);
    }
  }
  return value as SyncVector;
};

const validateAnnotation = (value: unknown) => {
  if (!isRecord(value)) {
    fail('annotation must be an object');
  }
  const kind = value.kind;
  if (kind === 'stroke') {
    const required = [
      'kind',
      'id',
      'conferenceId',
      'talkId',
      'deckId',
      'slideId',
      'createdAt',
      'updatedAt',
      'points',
    ];
    const optional = ['baseWidth', 'color'];
    exactKeys(
      value,
      [...required, ...optional].filter((key) => key in value),
    );
    for (const key of required.slice(1, 6)) {
      if (typeof value[key] !== 'string' || value[key] === '') {
        fail(`stroke ${key} must be a non-empty string`);
      }
    }
    if (
      !isSafeInteger(value.createdAt) ||
      !isSafeInteger(value.updatedAt) ||
      !Array.isArray(value.points) ||
      value.points.length < 1 ||
      value.points.length > 20_000
    ) {
      fail('stroke timestamps or points are invalid');
    }
    if (
      value.baseWidth !== undefined &&
      (typeof value.baseWidth !== 'number' ||
        !Number.isFinite(value.baseWidth) ||
        value.baseWidth <= 0)
    ) {
      fail('stroke baseWidth must be positive');
    }
    if (value.color !== undefined && typeof value.color !== 'string') {
      fail('stroke color must be a string');
    }
    for (const point of value.points) {
      if (
        !isRecord(point) ||
        Object.keys(point).sort().join(',') !== 'pressure,time,x,y' ||
        !['x', 'y', 'pressure', 'time'].every(
          (key) =>
            typeof point[key] === 'number' && Number.isFinite(point[key]),
        )
      ) {
        fail('stroke point is invalid');
      }
      if (
        (point.x as number) < 0 ||
        (point.x as number) > 1 ||
        (point.y as number) < 0 ||
        (point.y as number) > 1 ||
        (point.pressure as number) < 0 ||
        (point.pressure as number) > 1 ||
        (point.time as number) < 0
      ) {
        fail('stroke point is outside the supported range');
      }
    }
    return;
  }
  if (kind === 'text') {
    const required = [
      'kind',
      'id',
      'conferenceId',
      'talkId',
      'deckId',
      'slideId',
      'createdAt',
      'updatedAt',
      'x',
      'y',
      'text',
    ];
    exactKeys(value, [...required, ...('width' in value ? ['width'] : [])]);
    for (const key of required.slice(1, 6)) {
      if (typeof value[key] !== 'string' || value[key] === '') {
        fail(`text note ${key} must be a non-empty string`);
      }
    }
    if (
      !isSafeInteger(value.createdAt) ||
      !isSafeInteger(value.updatedAt) ||
      typeof value.x !== 'number' ||
      !Number.isFinite(value.x) ||
      typeof value.y !== 'number' ||
      !Number.isFinite(value.y) ||
      typeof value.text !== 'string' ||
      value.text.length > 16_384 ||
      (value.width !== undefined &&
        (typeof value.width !== 'number' ||
          !Number.isFinite(value.width) ||
          value.width <= 0))
    ) {
      fail('text note fields are invalid');
    }
    return;
  }
  fail('annotation kind is unsupported');
};

const validateMetadataEntity = (
  value: unknown,
  kind: 'conference' | 'talk' | 'deck',
  conferenceId: string,
) => {
  if (!isRecord(value)) {
    fail(`${kind} metadata must be an object`);
  }
  const schemas = {
    conference: {
      required: [
        'id',
        'sourceUrl',
        'title',
        'dates',
        'host',
        'sourceKind',
        'createdAt',
        'updatedAt',
      ],
      optional: ['timeZone'],
    },
    talk: {
      required: [
        'id',
        'conferenceId',
        'contributionId',
        'contributionUrl',
        'title',
        'speaker',
        'sessionTitle',
        'startsAt',
        'endsAt',
        'room',
        'createdAt',
        'updatedAt',
      ],
      optional: ['upstreamStatus', 'entryKind', 'linkedAgendaUrl'],
    },
    deck: {
      required: [
        'id',
        'conferenceId',
        'talkId',
        'sourceUrl',
        'displayName',
        'mimeType',
        'kind',
        'createdAt',
        'updatedAt',
      ],
      optional: ['upstreamStatus'],
    },
  };
  const schema = schemas[kind];
  exactKeys(value, [
    ...schema.required,
    ...schema.optional.filter((key) => key in value),
  ]);
  const textFields =
    kind === 'conference'
      ? ['id', 'sourceUrl', 'title', 'dates', 'host']
      : kind === 'talk'
        ? [
            'id',
            'conferenceId',
            'contributionId',
            'contributionUrl',
            'title',
            'speaker',
            'sessionTitle',
            'room',
          ]
        : [
            'id',
            'conferenceId',
            'talkId',
            'sourceUrl',
            'displayName',
            'mimeType',
          ];
  if (textFields.some((field) => typeof value[field] !== 'string')) {
    fail(`${kind} metadata has an invalid text field`);
  }
  if (!isSafeInteger(value.createdAt) || !isSafeInteger(value.updatedAt)) {
    fail(`${kind} metadata timestamps are invalid`);
  }
  if (kind === 'conference') {
    if (
      !isSafePathComponent(value.id) ||
      !isNonEmptyString(value.sourceUrl) ||
      value.id !== createConferenceId(value.sourceUrl) ||
      (value.sourceKind !== 'indico' && value.sourceKind !== 'web') ||
      (value.timeZone !== undefined &&
        value.timeZone !== null &&
        typeof value.timeZone !== 'string')
    ) {
      fail('conference metadata identity is invalid');
    }
    return;
  }
  if (value.conferenceId !== conferenceId) {
    fail(`${kind} metadata belongs to another conference`);
  }
  if (kind === 'talk') {
    if (
      !isSafePathComponent(value.id) ||
      !isNonEmptyString(value.contributionId) ||
      value.id !== createTalkId(conferenceId, value.contributionId) ||
      (value.startsAt !== null && !isSafeInteger(value.startsAt)) ||
      (value.endsAt !== null && !isSafeInteger(value.endsAt)) ||
      (value.upstreamStatus !== undefined &&
        value.upstreamStatus !== 'present' &&
        value.upstreamStatus !== 'changed' &&
        value.upstreamStatus !== 'missing') ||
      (value.entryKind !== undefined &&
        value.entryKind !== 'talk' &&
        value.entryKind !== 'linked-agenda') ||
      (value.linkedAgendaUrl !== undefined &&
        typeof value.linkedAgendaUrl !== 'string')
    ) {
      fail('talk metadata fields are invalid');
    }
    return;
  }
  if (
    !isSafePathComponent(value.id) ||
    !isNonEmptyString(value.talkId) ||
    !isNonEmptyString(value.sourceUrl) ||
    value.id !== createDeckId(value.talkId, value.sourceUrl) ||
    (value.kind !== 'pdf' && value.kind !== 'other') ||
    (value.upstreamStatus !== undefined &&
      value.upstreamStatus !== 'present' &&
      value.upstreamStatus !== 'changed' &&
      value.upstreamStatus !== 'missing')
  ) {
    fail('deck metadata fields are invalid');
  }
};

const validatePayload = (
  kind: string,
  payload: Record<string, unknown>,
  streamId: string,
  workspaceId: string,
) => {
  const streamKind = streamId.split(':', 1)[0];
  const expectedKind =
    kind === 'noop'
      ? streamKind
      : [
            'annotation.put',
            'annotation.erase',
            'document-version.associate',
          ].includes(kind)
        ? 'deck'
        : ['bookmark.set', 'conference.metadata', 'conference.delete'].includes(
              kind,
            )
          ? 'metadata'
          : null;
  if (expectedKind !== streamKind) {
    fail(`operation kind ${kind} is invalid for ${streamId}`);
  }
  if (kind === 'annotation.put') {
    exactKeys(payload, [
      'annotation',
      'documentVersion',
      'logicalNoteId',
      'branchOfOperationId',
    ]);
    validateAnnotation(payload.annotation);
    const annotation = payload.annotation as Record<string, unknown>;
    if (
      payload.documentVersion !== null &&
      (typeof payload.documentVersion !== 'string' ||
        !SHA256_PATTERN.test(payload.documentVersion))
    ) {
      fail('annotation documentVersion must be a SHA-256 or null');
    }
    if (annotation.kind === 'stroke') {
      if (
        payload.logicalNoteId !== null ||
        payload.branchOfOperationId !== null
      ) {
        fail('stroke note-branch fields must be null');
      }
    } else {
      if (
        typeof payload.logicalNoteId !== 'string' ||
        payload.logicalNoteId === '' ||
        (payload.branchOfOperationId !== null &&
          !isUuid(payload.branchOfOperationId))
      ) {
        fail('text note branch identity is invalid');
      }
      if (
        payload.branchOfOperationId === null
          ? annotation.id !== payload.logicalNoteId
          : annotation.id !==
            stableNoteBranchId(
              workspaceId,
              payload.logicalNoteId,
              payload.branchOfOperationId as string,
            )
      ) {
        fail('text note annotation ID does not match its branch identity');
      }
    }
    const deckId = streamId.slice('deck:'.length);
    if (streamId.startsWith('deck:') && annotation.deckId !== deckId) {
      fail('annotation deck does not match its stream');
    }
    return;
  }
  if (kind === 'annotation.erase') {
    exactKeys(payload, ['annotationId', 'documentVersion']);
    if (
      typeof payload.annotationId !== 'string' ||
      payload.annotationId === '' ||
      (payload.documentVersion !== null &&
        (typeof payload.documentVersion !== 'string' ||
          !SHA256_PATTERN.test(payload.documentVersion)))
    ) {
      fail('annotation erase target is invalid');
    }
    return;
  }
  if (kind === 'bookmark.set') {
    exactKeys(payload, ['talkId', 'bookmarked']);
    if (
      typeof payload.talkId !== 'string' ||
      payload.talkId === '' ||
      typeof payload.bookmarked !== 'boolean'
    ) {
      fail('bookmark payload is invalid');
    }
    return;
  }
  if (kind === 'conference.delete') {
    exactKeys(payload, ['deletedAt', 'reason']);
    if (!isSafeInteger(payload.deletedAt) || payload.reason !== 'user') {
      fail('conference deletion payload is invalid');
    }
    return;
  }
  if (kind === 'document-version.associate') {
    exactKeys(payload, ['annotationIds', 'fromVersion', 'toVersion']);
    if (
      !Array.isArray(payload.annotationIds) ||
      payload.annotationIds.length < 1 ||
      payload.annotationIds.length > 32 ||
      payload.annotationIds.some(
        (id) => typeof id !== 'string' || id.length === 0,
      ) ||
      new Set(payload.annotationIds).size !== payload.annotationIds.length ||
      payload.fromVersion !== null ||
      typeof payload.toVersion !== 'string' ||
      !SHA256_PATTERN.test(payload.toVersion)
    ) {
      fail('document version association is invalid');
    }
    return;
  }
  if (kind === 'noop') {
    exactKeys(payload, []);
    return;
  }
  if (kind === 'conference.metadata') {
    exactKeys(payload, [
      'batchId',
      'partIndex',
      'partCount',
      'conference',
      'talks',
      'decks',
      'upstreamRevision',
    ]);
    if (
      !isUuid(payload.batchId) ||
      !isSafeInteger(payload.partIndex) ||
      !isSafeInteger(payload.partCount, 1) ||
      payload.partIndex >= payload.partCount ||
      (payload.partIndex === 0) !== (payload.conference !== null) ||
      !Array.isArray(payload.talks) ||
      !Array.isArray(payload.decks) ||
      payload.talks.length + payload.decks.length > 32 ||
      (payload.upstreamRevision !== null &&
        typeof payload.upstreamRevision !== 'string')
    ) {
      fail('conference metadata batch part is invalid');
    }
    if (
      payload.conference !== null &&
      (!isRecord(payload.conference) ||
        payload.conference.id !== streamId.slice('metadata:'.length))
    ) {
      fail('conference metadata record does not match its stream');
    }
    if (payload.conference !== null) {
      validateMetadataEntity(
        payload.conference,
        'conference',
        streamId.slice('metadata:'.length),
      );
    }
    for (const talk of payload.talks) {
      validateMetadataEntity(talk, 'talk', streamId.slice('metadata:'.length));
    }
    for (const deck of payload.decks) {
      validateMetadataEntity(deck, 'deck', streamId.slice('metadata:'.length));
    }
    return;
  }
  fail(`unsupported operation kind for stream ${streamId}`);
};

export const createOperation = (
  fields: Omit<SyncOperation, 'integrity'>,
): SyncOperation => {
  const canonical = canonicalJson(fields);
  const bytes = Buffer.from(canonical, 'utf8');
  const operation: SyncOperation = {
    ...fields,
    integrity: { byteLength: bytes.byteLength, sha256: sha256Hex(bytes) },
  };
  validateOperation(operation);
  return operation;
};

export const validateOperation = (value: unknown): SyncOperation => {
  if (!isRecord(value)) {
    fail('operation must be an object');
  }
  exactKeys(value, [
    'format',
    'version',
    'workspaceId',
    'streamId',
    'deviceId',
    'sequence',
    'operationId',
    'context',
    'requires',
    'kind',
    'payload',
    'integrity',
  ]);
  if (
    value.format !== 'indicoink-operation' ||
    value.version !== 1 ||
    !isUuid(value.workspaceId) ||
    !isUuid(value.deviceId) ||
    !isUuid(value.operationId) ||
    !isSafeInteger(value.sequence, 1) ||
    typeof value.streamId !== 'string'
  ) {
    fail('operation identity fields are invalid');
  }
  const [streamKind, streamEntity, extra] = value.streamId.split(':');
  if (
    extra !== undefined ||
    !['metadata', 'deck'].includes(streamKind ?? '') ||
    !isSafePathComponent(streamEntity)
  ) {
    fail('operation stream ID is invalid');
  }
  const context = validateVector(value.context, 'context');
  if (
    (context[value.deviceId] ?? 0) !== value.sequence - 1 ||
    (value.sequence === 1 && context[value.deviceId] !== undefined)
  ) {
    fail('operation context does not match its own sequence');
  }
  if (!Array.isArray(value.requires)) {
    fail('requires must be an array');
  }
  const requiredStreams = new Set<string>();
  for (const requirement of value.requires) {
    if (!isRecord(requirement)) {
      fail('cross-stream requirement is invalid');
    }
    exactKeys(requirement, ['streamId', 'frontier']);
    if (
      typeof requirement.streamId !== 'string' ||
      !/^metadata:[A-Za-z0-9_-]{1,128}$/.test(requirement.streamId) ||
      streamKind !== 'deck' ||
      requiredStreams.has(requirement.streamId)
    ) {
      fail('cross-stream requirement stream ID is invalid');
    }
    requiredStreams.add(requirement.streamId);
    validateVector(requirement.frontier, 'requires.frontier');
  }
  if (!isRecord(value.payload) || typeof value.kind !== 'string') {
    fail('operation payload or kind is invalid');
  }
  const expectedPrefix = streamKind === 'metadata' ? 'metadata:' : 'deck:';
  const streamId = `${expectedPrefix}${streamEntity}`;
  if (value.streamId !== streamId) {
    fail('operation stream ID is not canonical');
  }
  validatePayload(value.kind, value.payload, streamId, value.workspaceId);
  if (!isRecord(value.integrity)) {
    fail('operation integrity is missing');
  }
  exactKeys(value.integrity, ['byteLength', 'sha256']);
  if (
    !isSafeInteger(value.integrity.byteLength, 1) ||
    typeof value.integrity.sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.integrity.sha256)
  ) {
    fail('operation integrity values are invalid');
  }
  const { integrity, ...fields } = value;
  const bytes = Buffer.from(canonicalJson(fields), 'utf8');
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > 2 * 1024 * 1024) {
    fail('operation exceeds 2 MiB limit');
  }
  if (
    bytes.byteLength !== integrity.byteLength ||
    sha256Hex(bytes) !== integrity.sha256
  ) {
    fail('operation integrity check failed');
  }
  return value as unknown as SyncOperation;
};

export const operationHappensBefore = (
  left: Pick<
    SyncOperation,
    'workspaceId' | 'streamId' | 'deviceId' | 'sequence'
  >,
  right: Pick<SyncOperation, 'workspaceId' | 'streamId' | 'context'>,
) =>
  left.workspaceId === right.workspaceId &&
  left.streamId === right.streamId &&
  (right.context[left.deviceId] ?? 0) >= left.sequence;

export const operationDominates = (left: SyncOperation, right: SyncOperation) =>
  operationHappensBefore(right, left);

export const causalMaxima = <T extends SyncOperation>(operations: T[]) => {
  const seen = new Map<string, string>();
  for (const operation of operations) {
    const bytes = canonicalJson(operation);
    const previous = seen.get(operation.operationId);
    if (previous !== undefined && previous !== bytes) {
      fail('conflicting bytes for one operation ID');
    }
    seen.set(operation.operationId, bytes);
  }
  return operations.filter(
    (candidate, index) =>
      operations.findIndex(
        (other) => other.operationId === candidate.operationId,
      ) === index &&
      !operations.some(
        (other, otherIndex) =>
          other.operationId !== candidate.operationId &&
          index !== otherIndex &&
          operationDominates(other, candidate),
      ),
  );
};

export const stableNoteBranchId = (
  workspaceId: string,
  logicalNoteId: string,
  branchOfOperationId: string,
) => {
  if (
    !isUuid(workspaceId) ||
    logicalNoteId.length === 0 ||
    !isUuid(branchOfOperationId)
  ) {
    fail('text branch identity inputs are invalid');
  }
  return `branch:${sha256Hex(
    `${workspaceId}\n${logicalNoteId}\n${branchOfOperationId}`,
  )}`;
};

export const mergeBookmarkOperations = (operations: SyncOperation[]) => {
  if (
    operations.length === 0 ||
    operations.some(
      (operation) =>
        operation.kind !== 'bookmark.set' ||
        operation.workspaceId !== operations[0]!.workspaceId ||
        operation.streamId !== operations[0]!.streamId ||
        operation.payload.talkId !== operations[0]!.payload.talkId,
    )
  ) {
    fail('bookmark merge requires operations for one talk and stream');
  }
  const maxima = causalMaxima(operations);
  const hasTrue = maxima.some(
    (operation) => operation.payload.bookmarked === true,
  );
  return { bookmarked: hasTrue, operations: maxima };
};
