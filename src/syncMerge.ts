import {
  canonicalJson,
  causalMaxima,
  mergeBookmarkOperations,
  operationDominates,
  stableNoteBranchId,
  type SyncOperation,
} from './syncProtocol';

export type AnnotationPutPayload = {
  annotation: Record<string, unknown> & { id: string; kind: 'stroke' | 'text' };
  documentVersion: string | null;
  logicalNoteId: string | null;
  branchOfOperationId: string | null;
  resolves: string[];
};

export type AnnotationErasePayload = {
  annotationId: string;
  documentVersion: string | null;
};

export type MergedAnnotation = {
  documentVersion: string | null;
  annotation: AnnotationPutPayload['annotation'];
  logicalNoteId: string | null;
  branchOfOperationId: string | null;
  causes: SyncOperation[];
};

export type AnnotationTombstone = {
  documentVersion: string | null;
  annotationId: string;
  causes: SyncOperation[];
};

export type AnnotationConflict = {
  documentVersion: string | null;
  annotationId: string;
  alternatives: Array<
    | { kind: 'put'; operation: SyncOperation }
    | { kind: 'erase'; operation: SyncOperation }
  >;
};

export type AnnotationMergeResult = {
  annotations: MergedAnnotation[];
  tombstones: AnnotationTombstone[];
  conflicts: AnnotationConflict[];
  duplicateOperationIds: string[];
};

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const operationBytes = (operation: SyncOperation) => canonicalJson(operation);

const uniqueOperations = (operations: SyncOperation[]) => {
  const byId = new Map<string, SyncOperation>();
  for (const operation of operations) {
    const previous = byId.get(operation.operationId);
    if (previous && operationBytes(previous) !== operationBytes(operation)) {
      throw new Error(
        `Conflicting bytes for sync operation ${operation.operationId}.`,
      );
    }
    byId.set(operation.operationId, operation);
  }
  return [...byId.values()];
};

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const annotationPayload = (operation: SyncOperation): AnnotationPutPayload => {
  if (operation.kind !== 'annotation.put') {
    throw new Error('Expected annotation.put operation.');
  }
  return operation.payload as unknown as AnnotationPutPayload;
};

const erasePayload = (operation: SyncOperation): AnnotationErasePayload => {
  if (operation.kind !== 'annotation.erase') {
    throw new Error('Expected annotation.erase operation.');
  }
  return operation.payload as unknown as AnnotationErasePayload;
};

const documentVersionOf = (operation: SyncOperation) =>
  operation.kind === 'annotation.put'
    ? annotationPayload(operation).documentVersion
    : erasePayload(operation).documentVersion;

const annotationIdOf = (operation: SyncOperation) =>
  operation.kind === 'annotation.put'
    ? annotationPayload(operation).annotation.id
    : erasePayload(operation).annotationId;

const compareOperation = (left: SyncOperation, right: SyncOperation) =>
  compareText(left.deviceId, right.deviceId) ||
  left.sequence - right.sequence ||
  compareText(left.operationId, right.operationId);

const hasSameNoteBranchOrigin = (
  left: AnnotationPutPayload,
  right: AnnotationPutPayload,
) =>
  left.logicalNoteId !== null &&
  left.logicalNoteId === right.logicalNoteId &&
  left.annotation.kind === 'text' &&
  right.annotation.kind === 'text' &&
  left.branchOfOperationId === null &&
  right.branchOfOperationId === null;

const originalBranchOperationId = (
  operation: SyncOperation,
  candidates: SyncOperation[],
) => {
  const ancestors = candidates.filter(
    (candidate) =>
      candidate.kind === 'annotation.put' &&
      (candidate.operationId === operation.operationId ||
        operationDominates(operation, candidate)),
  );
  const roots = ancestors.filter(
    (candidate) =>
      !ancestors.some(
        (other) =>
          other.operationId !== candidate.operationId &&
          operationDominates(candidate, other),
      ),
  );
  return roots.sort(compareOperation)[0]?.operationId ?? operation.operationId;
};

/**
 * Merge one independently loaded deck stream. The caller supplies only validated
 * operations whose cross-stream prerequisites are already satisfied.
 */
export const mergeAnnotationOperations = (
  input: SyncOperation[],
): AnnotationMergeResult => {
  const operations = uniqueOperations(input);
  if (
    operations.some(
      (operation) =>
        !operation.streamId.startsWith('deck:') ||
        !['annotation.put', 'annotation.erase'].includes(operation.kind),
    )
  ) {
    throw new Error(
      'Annotation merge requires one deck stream of annotations.',
    );
  }
  if (
    operations.some(
      (operation) =>
        operation.workspaceId !== operations[0]?.workspaceId ||
        operation.streamId !== operations[0]?.streamId,
    )
  ) {
    throw new Error(
      'Annotation operations must belong to one workspace stream.',
    );
  }

  const byOperationId = new Map(
    operations.map((operation) => [operation.operationId, operation]),
  );
  const resolvedOperationIds = new Set<string>();
  for (const operation of operations) {
    if (operation.kind !== 'annotation.put') continue;
    const payload = annotationPayload(operation);
    if (
      payload.annotation.kind === 'text' &&
      payload.branchOfOperationId === null
    ) {
      const observed = causalMaxima(
        operations.filter(
          (candidate) =>
            candidate.kind === 'annotation.put' &&
            candidate.operationId !== operation.operationId &&
            annotationPayload(candidate).annotation.id ===
              payload.annotation.id &&
            documentVersionOf(candidate) === payload.documentVersion &&
            operationDominates(operation, candidate),
        ),
      );
      if (
        observed.length > 1 &&
        observed.some(
          (candidate) => !payload.resolves.includes(candidate.operationId),
        )
      ) {
        throw new Error(
          'A text edit observing concurrent alternatives must explicitly resolve every observed alternative.',
        );
      }
    }
    for (const operationId of payload.resolves ?? []) {
      const resolved = byOperationId.get(operationId);
      if (
        !resolved ||
        resolved.kind !== 'annotation.put' ||
        payload.annotation.kind !== 'text' ||
        annotationPayload(resolved).annotation.kind !== 'text' ||
        annotationPayload(resolved).logicalNoteId !== payload.logicalNoteId ||
        documentVersionOf(resolved) !== payload.documentVersion ||
        !operationDominates(operation, resolved)
      ) {
        throw new Error(
          'A text resolution must causally observe each matching put alternative.',
        );
      }
      resolvedOperationIds.add(operationId);
    }
  }

  const duplicateOperationIds = input
    .filter(
      (operation, index) =>
        input.findIndex(
          (candidate) => candidate.operationId === operation.operationId,
        ) !== index,
    )
    .map(({ operationId }) => operationId)
    .filter((operationId, index, all) => all.indexOf(operationId) === index)
    .sort(compareText);

  const grouped = new Map<string, SyncOperation[]>();
  for (const operation of operations) {
    if (resolvedOperationIds.has(operation.operationId)) continue;
    const key = `${documentVersionOf(operation) ?? 'unknown'}\n${annotationIdOf(operation)}`;
    const group = grouped.get(key) ?? [];
    group.push(operation);
    grouped.set(key, group);
  }

  const annotations: MergedAnnotation[] = [];
  const tombstones: AnnotationTombstone[] = [];
  const conflicts: AnnotationConflict[] = [];
  const keepBothNotes = new Map<
    string,
    Array<{
      operation: SyncOperation;
      payload: AnnotationPutPayload;
      branchOfOperationId: string;
    }>
  >();

  for (const candidates of grouped.values()) {
    const maxima = causalMaxima(candidates).sort(compareOperation);
    const puts = maxima.filter(
      (operation) => operation.kind === 'annotation.put',
    );
    const erases = maxima.filter(
      (operation) => operation.kind === 'annotation.erase',
    );
    const first = maxima[0]!;
    const documentVersion = documentVersionOf(first);
    const annotationId = annotationIdOf(first);

    if (maxima.length > 1) {
      const putPayloads = puts.map((operation) => ({
        operation,
        payload: annotationPayload(operation),
      }));
      const allSameTextNote =
        erases.length === 0 &&
        putPayloads.length === maxima.length &&
        putPayloads.length > 1 &&
        putPayloads.every(({ payload }) =>
          hasSameNoteBranchOrigin(payload, putPayloads[0]!.payload),
        );

      if (allSameTextNote) {
        const logicalNoteId = putPayloads[0]!.payload.logicalNoteId!;
        const key = canonicalJson([documentVersion, logicalNoteId]);
        const branches = keepBothNotes.get(key) ?? [];
        branches.push(
          ...putPayloads.map(({ operation, payload }) => ({
            operation,
            payload,
            branchOfOperationId: originalBranchOperationId(
              operation,
              candidates,
            ),
          })),
        );
        keepBothNotes.set(key, branches);
      } else {
        conflicts.push({
          documentVersion,
          annotationId,
          alternatives: maxima.map((operation) => ({
            kind:
              operation.kind === 'annotation.put'
                ? ('put' as const)
                : ('erase' as const),
            operation,
          })),
        });
      }
      continue;
    }

    const operation = maxima[0];
    if (!operation) continue;
    if (operation.kind === 'annotation.erase') {
      tombstones.push({
        documentVersion,
        annotationId,
        causes: [operation],
      });
    } else {
      const payload = annotationPayload(operation);
      annotations.push({
        documentVersion,
        annotation: payload.annotation,
        logicalNoteId: payload.logicalNoteId,
        branchOfOperationId: payload.branchOfOperationId,
        causes: [operation],
      });
    }
  }

  for (const [key, branches] of keepBothNotes) {
    const [documentVersion, logicalNoteId] = JSON.parse(key) as [
      string | null,
      string,
    ];
    const byBranchId = new Map<
      string,
      {
        operation: SyncOperation;
        payload: AnnotationPutPayload;
        branchOfOperationId: string;
      }
    >();
    for (const branch of branches) {
      const branchId = stableNoteBranchId(
        operations[0]!.workspaceId,
        logicalNoteId!,
        branch.branchOfOperationId,
      );
      byBranchId.set(branchId, branch);
    }
    for (const [branchId, branch] of [...byBranchId].sort(([a], [b]) =>
      compareText(a, b),
    )) {
      const descendants = grouped.get(
        `${documentVersion ?? 'unknown'}\n${branchId}`,
      );
      if (
        descendants?.some((descendant) =>
          operationDominates(descendant, branch.operation),
        )
      ) {
        continue;
      }
      annotations.push({
        documentVersion,
        annotation: { ...branch.payload.annotation, id: branchId },
        logicalNoteId,
        branchOfOperationId: branch.branchOfOperationId,
        causes: [branch.operation],
      });
    }
  }

  annotations.sort(
    (left, right) =>
      compareText(left.documentVersion ?? '', right.documentVersion ?? '') ||
      compareText(left.annotation.id, right.annotation.id),
  );
  tombstones.sort(
    (left, right) =>
      compareText(left.documentVersion ?? '', right.documentVersion ?? '') ||
      compareText(left.annotationId, right.annotationId),
  );
  conflicts.sort(
    (left, right) =>
      compareText(left.documentVersion ?? '', right.documentVersion ?? '') ||
      compareText(left.annotationId, right.annotationId),
  );

  return { annotations, tombstones, conflicts, duplicateOperationIds };
};

/** Bookmark conflicts are intentionally biased toward keeping the bookmark. */
export const mergeBookmarkState = (operations: SyncOperation[]) =>
  mergeBookmarkOperations(operations);

export type MetadataRefresh = {
  operation: SyncOperation;
  upstreamRevision: string | null;
  records: Record<string, unknown>;
};

export const mergeMetadataRefreshes = (refreshes: MetadataRefresh[]) => {
  if (refreshes.length === 0)
    return { refresh: null, alternatives: [] as MetadataRefresh[] };
  const maxima = causalMaxima(refreshes.map(({ operation }) => operation));
  const candidates = maxima.map(
    (operation) =>
      refreshes.find(
        (candidate) =>
          candidate.operation.operationId === operation.operationId,
      )!,
  );
  if (candidates.length === 1) {
    return { refresh: candidates[0]!, alternatives: [] as MetadataRefresh[] };
  }
  const revisions = new Set(
    candidates.map(({ upstreamRevision }) => upstreamRevision),
  );
  if (revisions.size === 1) {
    return {
      refresh: [...candidates].sort((a, b) =>
        compareOperation(a.operation, b.operation),
      )[0]!,
      alternatives: [] as MetadataRefresh[],
    };
  }
  return { refresh: null, alternatives: candidates };
};

export const mergeConcurrentConferenceDeletion = (
  operations: SyncOperation[],
) => {
  const maxima = causalMaxima(operations);
  const deletions = maxima.filter(
    (operation) => operation.kind === 'conference.delete',
  );
  if (deletions.length === 0) return { deleted: false, operations: maxima };
  return { deleted: true, operations: maxima };
};

export const getNoteLogicalId = (operation: SyncOperation) => {
  if (operation.kind !== 'annotation.put') return null;
  const payload = annotationPayload(operation);
  return stringOrNull(payload.logicalNoteId);
};
