import { describe, expect, it } from 'vitest';
import {
  createConferenceId,
  createDeckId,
  createTalkId,
} from './persistenceModels';

import {
  canonicalJson,
  causalMaxima,
  createOperation,
  decodeStreamKey,
  encodeStreamKey,
  mergeBookmarkOperations,
  operationBucket,
  operationDominates,
  operationPath,
  validateOperationLocation,
  parseStrictSyncJson,
  stableNoteBranchId,
  validateOperation,
} from './syncProtocol';

const workspaceId = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
const deviceA = '72fc257a-40d2-4b19-ae71-b2a02f4fe5e6';
const deviceB = '639be5ee-82ea-4a08-93a9-afc608990bdc';
const conferenceId = 'conference_14f75f8a2a03f095fbf0';
const operationId = 'a8dd3a82-622b-48ac-9d2a-6b4f6e7f1d35';

const metadataDelete = (
  deviceId: string,
  id: string,
  sequence: number,
  context: Record<string, number> = {},
) =>
  createOperation({
    format: 'indicoink-operation',
    version: 1,
    workspaceId,
    streamId: `metadata:${conferenceId}`,
    deviceId,
    sequence,
    operationId: id,
    context,
    requires: [],
    kind: 'conference.delete',
    payload: { deletedAt: 1700000000000, reason: 'user' },
  });

describe('local folder sync protocol', () => {
  it('serializes JSON keys in Unicode code point order', () => {
    expect(canonicalJson({ '😀': 1, '\uE000': 2, a: 3 })).toBe(
      '{"a":3,"":2,"😀":1}',
    );
    expect(() => canonicalJson({ value: -0 })).toThrow(/negative zero/);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson(new Array(1))).toThrow(/holes/);
  });

  it('round-trips bounded reversible stream keys and 512-sequence buckets', () => {
    for (const streamId of ['metadata:conference_abc', 'deck:deck_123']) {
      expect(decodeStreamKey(encodeStreamKey(streamId))).toBe(streamId);
    }
    expect(operationBucket(1)).toBe('0');
    expect(operationBucket(512)).toBe('0');
    expect(operationBucket(513)).toBe('1');
    expect(() => decodeStreamKey('eA==')).toThrow(/base64url/);
  });

  it('parses only bounded canonical UTF-8 JSON without duplicate keys', () => {
    expect(parseStrictSyncJson(Buffer.from('{"a":1}'))).toEqual({ a: 1 });
    expect(() => parseStrictSyncJson(Buffer.from('{"a":1,"a":2}'))).toThrow(
      /duplicate key/,
    );
    expect(() => parseStrictSyncJson(Buffer.from('{ "a":1 }'))).toThrow(
      /not canonical/,
    );
    expect(
      parseStrictSyncJson(Buffer.from('{ "a":1 }'), {
        requireCanonical: false,
      }),
    ).toEqual({ a: 1 });
    expect(() => parseStrictSyncJson(new Uint8Array([0xff]))).toThrow(/UTF-8/);
    expect(() =>
      parseStrictSyncJson(Buffer.from('{"a":{"b":1}}'), { maxDepth: 1 }),
    ).toThrow(/nesting/);
    expect(() => parseStrictSyncJson(Buffer.from('{"a":"\\q"}'))).toThrow(
      /invalid escape/,
    );
  });

  it('creates and verifies immutable operation integrity and paths', () => {
    const operation = metadataDelete(deviceA, operationId, 1);
    expect(validateOperation(operation)).toEqual(operation);
    expect(operationPath(operation, conferenceId)).toBe(
      `conferences/${conferenceId}/metadata/ops/${deviceA}/0/1-${operationId}.json`,
    );
    expect(() =>
      validateOperationLocation(
        operationPath(operation, conferenceId),
        operation,
      ),
    ).not.toThrow();
    expect(() =>
      validateOperationLocation(
        `conferences/${conferenceId}/metadata/ops/${deviceA}/1/1-${operationId}.json`,
        operation,
      ),
    ).toThrow(/operation path/);
    expect(() =>
      validateOperation({
        ...operation,
        payload: { deletedAt: 4, reason: 'user' },
      }),
    ).toThrow(/integrity/);
    expect(() => validateOperation({ ...operation, unexpected: true })).toThrow(
      /expected fields/,
    );
  });

  it('rejects a context that claims future local operations', () => {
    expect(() =>
      metadataDelete(deviceA, operationId, 3, { [deviceA]: 1 }),
    ).toThrow(/context/);
    expect(() => metadataDelete(deviceA, operationId, 3)).toThrow(/context/);
  });

  it('rejects invalid stream placement and cross-stream causal claims', () => {
    const first = metadataDelete(deviceA, operationId, 1);
    const deckOperation = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: 'deck:deck_abc',
      deviceId: deviceB,
      sequence: 1,
      operationId: '2bb1ca45-4386-46a8-89b5-7f12f3564240',
      context: { [deviceA]: 1 },
      requires: [],
      kind: 'noop',
      payload: {},
    });
    expect(operationDominates(deckOperation, first)).toBe(false);
    expect(() => operationPath(first, 'conference_other')).toThrow(
      /match conference path/,
    );
    const { integrity: _integrity, ...fields } = first;
    void _integrity;
    expect(() =>
      createOperation({
        ...fields,
        streamId: 'deck:deck_abc',
      }),
    ).toThrow(/invalid for/);
  });

  it('rejects a note whose branch identity disagrees with its annotation ID', () => {
    expect(() =>
      createOperation({
        format: 'indicoink-operation',
        version: 1,
        workspaceId,
        streamId: 'deck:deck_abc',
        deviceId: deviceA,
        sequence: 1,
        operationId,
        context: {},
        requires: [],
        kind: 'annotation.put',
        payload: {
          annotation: {
            kind: 'text',
            id: 'wrong',
            conferenceId,
            talkId: 'talk_abc',
            deckId: 'deck_abc',
            slideId: 'slide_abc',
            createdAt: 1,
            updatedAt: 1,
            x: 0.5,
            y: 0.5,
            text: 'note',
          },
          documentVersion: null,
          logicalNoteId: 'note_abc',
          branchOfOperationId: null,
        },
      }),
    ).toThrow(/branch identity/);
  });

  it('validates shared metadata shapes without device-local selection fields', () => {
    const sourceUrl = 'https://example.org/event';
    const metadataConferenceId = createConferenceId(sourceUrl);
    const fields = {
      format: 'indicoink-operation' as const,
      version: 1 as const,
      workspaceId,
      streamId: `metadata:${metadataConferenceId}`,
      deviceId: deviceA,
      sequence: 1,
      operationId,
      context: {},
      requires: [],
      kind: 'conference.metadata',
      payload: {
        batchId: '2bb1ca45-4386-46a8-89b5-7f12f3564240',
        partIndex: 0,
        partCount: 1,
        conference: {
          id: metadataConferenceId,
          sourceUrl,
          title: 'Event',
          dates: '',
          host: 'example.org',
          sourceKind: 'indico',
          createdAt: 1,
          updatedAt: 1,
        },
        talks: [],
        decks: [],
        upstreamRevision: null,
      },
    };
    expect(() => createOperation(fields)).not.toThrow();
    expect(() =>
      createOperation({
        ...fields,
        payload: {
          ...fields.payload,
          conference: {
            ...fields.payload.conference,
            sourceUrl: 'https://example.org/other',
          },
        },
      }),
    ).toThrow(/identity/);
    expect(() =>
      createOperation({
        ...fields,
        payload: {
          ...fields.payload,
          conference: { ...fields.payload.conference!, lastOpenedAt: 10 },
        },
      }),
    ).toThrow(/expected fields/);
  });

  it('validates talk and deck IDs against their parent and source identities', () => {
    const sourceUrl = 'https://example.org/event';
    const metadataConferenceId = createConferenceId(sourceUrl);
    const contributionId = '42';
    const talkId = createTalkId(metadataConferenceId, contributionId);
    const deckSourceUrl = 'https://example.org/slides.pdf';
    const deckId = createDeckId(talkId, deckSourceUrl);
    const talk = {
      id: talkId,
      conferenceId: metadataConferenceId,
      contributionId,
      contributionUrl: 'https://example.org/event/42',
      title: 'A talk',
      speaker: '',
      sessionTitle: '',
      startsAt: null,
      endsAt: null,
      room: '',
      createdAt: 1,
      updatedAt: 1,
    };
    const deck = {
      id: deckId,
      conferenceId: metadataConferenceId,
      talkId,
      sourceUrl: deckSourceUrl,
      displayName: 'Slides',
      mimeType: 'application/pdf',
      kind: 'pdf',
      createdAt: 1,
      updatedAt: 1,
    };
    const fields = {
      format: 'indicoink-operation' as const,
      version: 1 as const,
      workspaceId,
      streamId: `metadata:${metadataConferenceId}`,
      deviceId: deviceA,
      sequence: 1,
      operationId,
      context: {},
      requires: [],
      kind: 'conference.metadata',
      payload: {
        batchId: '2bb1ca45-4386-46a8-89b5-7f12f3564240',
        partIndex: 0,
        partCount: 1,
        conference: {
          id: metadataConferenceId,
          sourceUrl,
          title: 'Event',
          dates: '',
          host: 'example.org',
          sourceKind: 'indico',
          createdAt: 1,
          updatedAt: 1,
        },
        talks: [talk],
        decks: [deck],
        upstreamRevision: null,
      },
    };
    expect(() => createOperation(fields)).not.toThrow();
    expect(() =>
      createOperation({
        ...fields,
        payload: {
          ...fields.payload,
          talks: [{ ...talk, contributionId: '43' }],
        },
      }),
    ).toThrow(/talk metadata fields/);
    expect(() =>
      createOperation({
        ...fields,
        payload: {
          ...fields.payload,
          decks: [{ ...deck, sourceUrl: 'https://example.org/other.pdf' }],
        },
      }),
    ).toThrow(/deck metadata fields/);
  });

  it('keeps only causal maxima and favors a concurrent bookmark', () => {
    const first = metadataDelete(deviceA, operationId, 1);
    const second = metadataDelete(
      deviceB,
      '2bb1ca45-4386-46a8-89b5-7f12f3564240',
      1,
      { [deviceA]: 1 },
    );
    expect(operationDominates(second, first)).toBe(true);
    expect(causalMaxima([first, second])).toEqual([second]);

    const bookmark = (deviceId: string, id: string, bookmarked: boolean) =>
      createOperation({
        format: 'indicoink-operation',
        version: 1,
        workspaceId,
        streamId: `metadata:${conferenceId}`,
        deviceId,
        sequence: 1,
        operationId: id,
        context: {},
        requires: [],
        kind: 'bookmark.set',
        payload: { talkId: 'talk_abc', bookmarked },
      });
    expect(
      mergeBookmarkOperations([
        bookmark(deviceA, operationId, false),
        bookmark(deviceB, '2bb1ca45-4386-46a8-89b5-7f12f3564240', true),
      ]).bookmarked,
    ).toBe(true);
  });

  it('derives the same text branch ID on every device', () => {
    const branchOperationId = '2bb1ca45-4386-46a8-89b5-7f12f3564240';
    const first = stableNoteBranchId(
      workspaceId,
      'annotation_abc',
      branchOperationId,
    );
    expect(first).toMatch(/^branch:[0-9a-f]{64}$/);
    expect(
      stableNoteBranchId(workspaceId, 'annotation_abc', branchOperationId),
    ).toBe(first);
  });
});
