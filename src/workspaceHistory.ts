import type { InkStroke } from './strokeTools';
import type { TextNote } from './persistenceModels';
import type {
  PdfWorkspaceHistory,
  PdfWorkspacePageState,
  WorkspaceHistoryChange,
  WorkspaceHistoryEntry,
  WorkspaceHistoryValue,
} from './shared/pdfWorkspace';

export const MAX_WORKSPACE_HISTORY_ENTRIES = 200;

export type WorkspacePages = {
  strokesByPage: InkStroke[][];
  textNotesByPage: TextNote[][];
};

const cloneStroke = (stroke: InkStroke): InkStroke => ({
  ...stroke,
  points: [...stroke.points],
});

const cloneNote = (note: TextNote): TextNote => ({ ...note });

const createEntryId = () =>
  `history-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

export const createWorkspaceHistory = (): PdfWorkspaceHistory => ({
  version: 2,
  undo: [],
  redo: [],
});

export const pushWorkspaceHistory = (
  history: PdfWorkspaceHistory,
  entry: WorkspaceHistoryEntry,
): PdfWorkspaceHistory => ({
  version: 2,
  undo: [entry, ...history.undo].slice(0, MAX_WORKSPACE_HISTORY_ENTRIES),
  redo: [],
});

const replaceIndexedValue = <T extends { id: string }>(
  values: T[],
  annotationId: string,
  target: WorkspaceHistoryValue<T> | null,
  clone: (value: T) => T,
) => {
  const next = values.filter((value) => value.id !== annotationId);
  if (!target) {
    return next;
  }

  next.splice(
    Math.max(0, Math.min(target.index, next.length)),
    0,
    clone(target.value),
  );
  return next;
};

export const applyWorkspaceHistoryEntry = (
  pages: WorkspacePages,
  entry: WorkspaceHistoryEntry,
  direction: 'undo' | 'redo',
): WorkspacePages => {
  const strokesByPage = [...pages.strokesByPage];
  const textNotesByPage = [...pages.textNotesByPage];

  for (const change of entry.changes) {
    if (change.kind === 'stroke') {
      const target = direction === 'undo' ? change.before : change.after;
      strokesByPage[change.pageIndex] = replaceIndexedValue(
        strokesByPage[change.pageIndex] ?? [],
        change.annotationId,
        target,
        cloneStroke,
      );
    } else {
      const target = direction === 'undo' ? change.before : change.after;
      textNotesByPage[change.pageIndex] = replaceIndexedValue(
        textNotesByPage[change.pageIndex] ?? [],
        change.annotationId,
        target,
        cloneNote,
      );
    }
  }

  return { strokesByPage, textNotesByPage };
};

export const undoWorkspaceHistory = (
  pages: WorkspacePages,
  history: PdfWorkspaceHistory,
) => {
  const entry = history.undo[0];
  if (!entry) {
    return null;
  }

  return {
    pages: applyWorkspaceHistoryEntry(pages, entry, 'undo'),
    history: {
      version: 2 as const,
      undo: history.undo.slice(1),
      redo: [entry, ...history.redo].slice(0, MAX_WORKSPACE_HISTORY_ENTRIES),
    },
  };
};

export const redoWorkspaceHistory = (
  pages: WorkspacePages,
  history: PdfWorkspaceHistory,
) => {
  const entry = history.redo[0];
  if (!entry) {
    return null;
  }

  return {
    pages: applyWorkspaceHistoryEntry(pages, entry, 'redo'),
    history: {
      version: 2 as const,
      undo: [entry, ...history.undo].slice(0, MAX_WORKSPACE_HISTORY_ENTRIES),
      redo: history.redo.slice(1),
    },
  };
};

const valuesEqual = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const diffValues = <T extends { id: string }>(
  kind: 'stroke' | 'text-note',
  pageIndex: number,
  before: T[],
  after: T[],
): WorkspaceHistoryChange[] => {
  const beforeById = new Map(
    before.map((value, index) => [value.id, { value, index }]),
  );
  const afterById = new Map(
    after.map((value, index) => [value.id, { value, index }]),
  );
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  const changes: WorkspaceHistoryChange[] = [];

  for (const annotationId of ids) {
    const beforeValue = beforeById.get(annotationId);
    const afterValue = afterById.get(annotationId);
    if (
      beforeValue &&
      afterValue &&
      beforeValue.index === afterValue.index &&
      (beforeValue.value === afterValue.value ||
        valuesEqual(beforeValue.value, afterValue.value))
    ) {
      continue;
    }

    const beforeTarget = beforeValue
      ? {
          index: beforeValue.index,
          value:
            kind === 'stroke'
              ? cloneStroke(beforeValue.value as unknown as InkStroke)
              : cloneNote(beforeValue.value as unknown as TextNote),
        }
      : null;
    const afterTarget = afterValue
      ? {
          index: afterValue.index,
          value:
            kind === 'stroke'
              ? cloneStroke(afterValue.value as unknown as InkStroke)
              : cloneNote(afterValue.value as unknown as TextNote),
        }
      : null;

    changes.push({
      kind,
      pageIndex,
      annotationId,
      before: beforeTarget,
      after: afterTarget,
    } as WorkspaceHistoryChange);
  }

  return changes;
};

export const createWorkspaceHistoryEntry = (
  before: WorkspacePages,
  after: WorkspacePages,
): WorkspaceHistoryEntry | null => {
  const pageCount = Math.max(
    before.strokesByPage.length,
    before.textNotesByPage.length,
    after.strokesByPage.length,
    after.textNotesByPage.length,
  );
  const changes: WorkspaceHistoryChange[] = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const beforeStrokes = before.strokesByPage[pageIndex] ?? [];
    const afterStrokes = after.strokesByPage[pageIndex] ?? [];
    const beforeNotes = before.textNotesByPage[pageIndex] ?? [];
    const afterNotes = after.textNotesByPage[pageIndex] ?? [];
    if (beforeStrokes === afterStrokes && beforeNotes === afterNotes) {
      continue;
    }
    changes.push(
      ...diffValues('stroke', pageIndex, beforeStrokes, afterStrokes),
      ...diffValues('text-note', pageIndex, beforeNotes, afterNotes),
    );
  }

  return changes.length ? { id: createEntryId(), changes } : null;
};

const snapshotToPages = (
  snapshot: PdfWorkspacePageState[],
): WorkspacePages => ({
  strokesByPage: snapshot.map((page) => page.strokes),
  textNotesByPage: snapshot.map((page) => page.textNotes),
});

export const migrateLegacyWorkspaceHistory = (
  current: WorkspacePages,
  undoStack: PdfWorkspacePageState[][] = [],
  redoStack: PdfWorkspacePageState[][] = [],
): PdfWorkspaceHistory => {
  const undo: WorkspaceHistoryEntry[] = [];
  let after = current;
  for (const snapshot of undoStack.slice(0, MAX_WORKSPACE_HISTORY_ENTRIES)) {
    const before = snapshotToPages(snapshot);
    const entry = createWorkspaceHistoryEntry(before, after);
    if (entry) {
      undo.push(entry);
    }
    after = before;
  }

  const redo: WorkspaceHistoryEntry[] = [];
  let before = current;
  for (const snapshot of redoStack.slice(0, MAX_WORKSPACE_HISTORY_ENTRIES)) {
    const next = snapshotToPages(snapshot);
    const entry = createWorkspaceHistoryEntry(before, next);
    if (entry) {
      redo.push(entry);
    }
    before = next;
  }

  return { version: 2, undo, redo };
};
