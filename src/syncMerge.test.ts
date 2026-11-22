import { describe, expect, it } from 'vitest';

import {
  createOperation,
  stableNoteBranchId,
  type SyncOperation,
} from './syncProtocol';
import { mergeAnnotationOperations, mergeBookmarkState } from './syncMerge';

const workspaceId = '9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d';
const deviceA = '72fc257a-40d2-4b19-ae71-b2a02f4fe5e6';
const deviceB = '639be5ee-82ea-4a08-93a9-afc608990bdc';
const deviceC = '5b9f257a-40d2-4b19-ae71-b2a02f4fe5e6';
const deckId = 'deck_123';
const noteId = 'note-1';

const textNote = (text: string, id = noteId) => ({
  kind: 'text' as const,
  id,
  conferenceId: 'conference_1',
  talkId: 'talk_1',
  deckId,
  slideId: 'slide_1',
  createdAt: 100,
  updatedAt: 100,
  x: 0.25,
  y: 0.5,
  text,
});

const put = (
  deviceId: string,
  sequence: number,
  context: Record<string, number>,
  text: string,
  id = `${deviceId.slice(0, 8)}-0000-4000-8000-000000000001`,
  logicalId = noteId,
): SyncOperation =>
  createOperation({
    format: 'indicoink-operation',
    version: 1,
    workspaceId,
    streamId: `deck:${deckId}`,
    deviceId,
    sequence,
    operationId: id,
    context,
    requires: [],
    kind: 'annotation.put',
    payload: {
      annotation: textNote(text, logicalId),
      documentVersion: null,
      logicalNoteId: logicalId,
      branchOfOperationId: null,
      resolves: [],
    },
  });

const erase = (
  deviceId: string,
  sequence: number,
  context: Record<string, number>,
  annotationId: string,
  id: string,
): SyncOperation =>
  createOperation({
    format: 'indicoink-operation',
    version: 1,
    workspaceId,
    streamId: `deck:${deckId}`,
    deviceId,
    sequence,
    operationId: id,
    context,
    requires: [],
    kind: 'annotation.erase',
    payload: { annotationId, documentVersion: null },
  });

describe('sync merge', () => {
  it('keeps independent annotation IDs and removes a causally erased value', () => {
    const first = put(deviceA, 1, {}, 'one');
    const independent = put(
      deviceC,
      1,
      {},
      'two',
      'aa444444-0000-4000-8000-000000000001',
      'note-2',
    );
    const deletion = erase(
      deviceA,
      2,
      { [deviceA]: 1 },
      noteId,
      'bb444444-0000-4000-8000-000000000001',
    );
    const merged = mergeAnnotationOperations([first, independent, deletion]);
    expect(merged.annotations.map(({ annotation }) => annotation.id)).toEqual([
      'note-2',
    ]);
    expect(merged.tombstones.map(({ annotationId }) => annotationId)).toEqual([
      noteId,
    ]);
    expect(merged.conflicts).toEqual([]);
  });

  it('keeps concurrent same-note edits as deterministic editable branches', () => {
    const left = put(deviceA, 1, {}, 'left');
    const right = put(deviceB, 1, {}, 'right');
    const merged = mergeAnnotationOperations([right, left]);
    expect(merged.annotations).toHaveLength(2);
    expect(
      merged.annotations.map(({ annotation }) => annotation.id).sort(),
    ).toEqual(
      [
        stableNoteBranchId(workspaceId, noteId, left.operationId),
        stableNoteBranchId(workspaceId, noteId, right.operationId),
      ].sort(),
    );
    expect(
      merged.annotations.map(({ annotation }) => annotation.text).sort(),
    ).toEqual(['left', 'right']);
    expect(
      mergeAnnotationOperations([left, right, left, right]).annotations,
    ).toEqual(merged.annotations);
    const conflictingDuplicate = {
      ...left,
      payload: { ...left.payload, annotation: textNote('changed') },
    } as SyncOperation;
    expect(() =>
      mergeAnnotationOperations([left, conflictingDuplicate]),
    ).toThrow(/Conflicting bytes/);
  });

  it('resolves text branches only when the operation names their causes', () => {
    const left = put(deviceA, 1, {}, 'left');
    const right = put(deviceB, 1, {}, 'right');
    const resolution = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: `deck:${deckId}`,
      deviceId: deviceA,
      sequence: 2,
      operationId: 'cc444444-0000-4000-8000-000000000001',
      context: { [deviceA]: 1, [deviceB]: 1 },
      requires: [],
      kind: 'annotation.put',
      payload: {
        annotation: textNote('combined'),
        documentVersion: null,
        logicalNoteId: noteId,
        branchOfOperationId: null,
        resolves: [left.operationId, right.operationId],
      },
    });
    const merged = mergeAnnotationOperations([left, right, resolution]);
    expect(merged.annotations).toHaveLength(1);
    expect(merged.annotations[0]?.annotation.text).toBe('combined');
    expect(merged.conflicts).toEqual([]);

    const malformedResolution = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: `deck:${deckId}`,
      deviceId: deviceA,
      sequence: 2,
      operationId: 'dd444444-0000-4000-8000-000000000001',
      context: { [deviceA]: 1 },
      requires: [],
      kind: 'annotation.put',
      payload: {
        annotation: textNote('bad resolution'),
        documentVersion: null,
        logicalNoteId: noteId,
        branchOfOperationId: null,
        resolves: [right.operationId],
      },
    });
    expect(() =>
      mergeAnnotationOperations([left, right, malformedResolution]),
    ).toThrow(/causally observe/);

    const { integrity, ...resolutionFields } = resolution;
    expect(integrity.sha256).toMatch(/^[0-9a-f]{64}$/);
    const partialResolution = createOperation({
      ...resolutionFields,
      operationId: 'ee444444-0000-4000-8000-000000000001',
      payload: { ...resolution.payload, resolves: [left.operationId] },
    });
    expect(() =>
      mergeAnnotationOperations([left, right, partialResolution]),
    ).toThrow(/every observed alternative/);

    const implicitResolution = createOperation({
      ...resolutionFields,
      operationId: 'ff444444-0000-4000-8000-000000000001',
      payload: { ...resolution.payload, resolves: [] },
    });
    expect(() =>
      mergeAnnotationOperations([left, right, implicitResolution]),
    ).toThrow(/every observed alternative/);

    const laterEdit = put(
      deviceA,
      3,
      { [deviceA]: 2, [deviceB]: 1 },
      'later edit',
      '11444444-0000-4000-8000-000000000001',
    );
    const afterResolution = mergeAnnotationOperations([
      left,
      right,
      resolution,
      laterEdit,
    ]);
    expect(afterResolution.annotations).toHaveLength(1);
    expect(afterResolution.annotations[0]?.annotation.text).toBe('later edit');
  });

  it('does not duplicate causally ordered text edits', () => {
    const first = put(deviceA, 1, {}, 'first');
    const second = put(
      deviceA,
      2,
      { [deviceA]: 1 },
      'second',
      'cc444444-0000-4000-8000-000000000001',
    );
    const merged = mergeAnnotationOperations([first, second]);
    expect(merged.annotations).toHaveLength(1);
    expect(merged.annotations[0]?.annotation.text).toBe('second');
    expect(merged.annotations[0]?.annotation.id).toBe(noteId);
  });

  it('retains the first put as the branch origin across a pre-split edit', () => {
    const first = put(deviceA, 1, {}, 'first');
    const edited = put(
      deviceA,
      2,
      { [deviceA]: 1 },
      'edited',
      'cc444444-0000-4000-8000-000000000001',
    );
    const other = put(deviceB, 1, {}, 'other');
    const merged = mergeAnnotationOperations([other, edited, first]);
    expect(
      merged.annotations.map(({ annotation }) => annotation.id).sort(),
    ).toEqual(
      [
        stableNoteBranchId(workspaceId, noteId, first.operationId),
        stableNoteBranchId(workspaceId, noteId, other.operationId),
      ].sort(),
    );
    expect(
      merged.annotations.find(({ annotation }) => annotation.text === 'edited')
        ?.branchOfOperationId,
    ).toBe(first.operationId);
  });

  it('replaces a materialized branch with its later edit or erase', () => {
    const left = put(deviceA, 1, {}, 'left');
    const right = put(deviceB, 1, {}, 'right');
    const leftBranchId = stableNoteBranchId(
      workspaceId,
      noteId,
      left.operationId,
    );
    const editedBranch = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: `deck:${deckId}`,
      deviceId: deviceA,
      sequence: 2,
      operationId: 'cc444444-0000-4000-8000-000000000001',
      context: { [deviceA]: 1, [deviceB]: 1 },
      requires: [],
      kind: 'annotation.put',
      payload: {
        annotation: textNote('left edited', leftBranchId),
        documentVersion: null,
        logicalNoteId: noteId,
        branchOfOperationId: left.operationId,
        resolves: [],
      },
    });
    const edited = mergeAnnotationOperations([left, right, editedBranch]);
    expect(edited.annotations).toHaveLength(2);
    expect(
      edited.annotations.find(
        ({ annotation }) => annotation.id === leftBranchId,
      )?.annotation.text,
    ).toBe('left edited');

    const deletedBranch = erase(
      deviceA,
      3,
      { [deviceA]: 2, [deviceB]: 1 },
      leftBranchId,
      'dd444444-0000-4000-8000-000000000001',
    );
    const erased = mergeAnnotationOperations([
      left,
      right,
      editedBranch,
      deletedBranch,
    ]);
    expect(erased.annotations).toHaveLength(1);
    expect(erased.tombstones.map(({ annotationId }) => annotationId)).toEqual([
      leftBranchId,
    ]);
  });

  it('keeps concurrent edits of one existing branch as alternatives', () => {
    const origin = put(deviceA, 1, {}, 'origin');
    const other = put(deviceC, 1, {}, 'other');
    const branchId = stableNoteBranchId(
      workspaceId,
      noteId,
      origin.operationId,
    );
    const branchPut = (deviceId: string, operationId: string) =>
      createOperation({
        format: 'indicoink-operation',
        version: 1,
        workspaceId,
        streamId: `deck:${deckId}`,
        deviceId,
        operationId,
        sequence: deviceId === deviceA ? 2 : 1,
        context: { [deviceA]: 1 },
        requires: [],
        kind: 'annotation.put',
        payload: {
          annotation: textNote(operationId, branchId),
          documentVersion: null,
          logicalNoteId: noteId,
          branchOfOperationId: origin.operationId,
          resolves: [],
        },
      });
    const merged = mergeAnnotationOperations([
      origin,
      other,
      branchPut(deviceA, 'cc444444-0000-4000-8000-000000000001'),
      branchPut(deviceB, 'dd444444-0000-4000-8000-000000000001'),
    ]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.alternatives).toHaveLength(2);
  });

  it('preserves concurrent edit-delete alternatives for explicit review', () => {
    const changed = put(deviceA, 1, {}, 'edited');
    const deleted = erase(
      deviceB,
      1,
      {},
      noteId,
      'dd444444-0000-4000-8000-000000000001',
    );
    const merged = mergeAnnotationOperations([changed, deleted]);
    expect(merged.annotations).toEqual([]);
    expect(merged.tombstones).toEqual([]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.alternatives).toHaveLength(2);
  });

  it('keeps a concurrent bookmark unless a later operation observes both', () => {
    const bookmark = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: 'metadata:conference_1',
      deviceId: deviceA,
      sequence: 1,
      operationId: 'ee444444-0000-4000-8000-000000000001',
      context: {},
      requires: [],
      kind: 'bookmark.set',
      payload: { talkId: 'talk_1', bookmarked: true },
    });
    const unbookmark = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: 'metadata:conference_1',
      deviceId: deviceB,
      sequence: 1,
      operationId: 'ff444444-0000-4000-8000-000000000001',
      context: {},
      requires: [],
      kind: 'bookmark.set',
      payload: { talkId: 'talk_1', bookmarked: false },
    });
    expect(mergeBookmarkState([bookmark, unbookmark]).bookmarked).toBe(true);
    const laterUnbookmark = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId: 'metadata:conference_1',
      deviceId: deviceA,
      sequence: 2,
      operationId: '11444444-0000-4000-8000-000000000001',
      context: { [deviceA]: 1, [deviceB]: 1 },
      requires: [],
      kind: 'bookmark.set',
      payload: { talkId: 'talk_1', bookmarked: false },
    });
    expect(
      mergeBookmarkState([bookmark, unbookmark, laterUnbookmark]).bookmarked,
    ).toBe(false);
  });
});
