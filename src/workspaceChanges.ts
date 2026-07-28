import type { WorkspaceAnnotationChange } from './shared/pdfWorkspace';
import type { WorkspacePages } from './workspaceHistory';

const valuesEqual = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export const diffWorkspaceAnnotations = (
  before: WorkspacePages,
  after: WorkspacePages,
): WorkspaceAnnotationChange[] => {
  const changes: WorkspaceAnnotationChange[] = [];
  const pageCount = Math.max(
    before.strokesByPage.length,
    before.textNotesByPage.length,
    after.strokesByPage.length,
    after.textNotesByPage.length,
  );

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const beforeStrokes = before.strokesByPage[pageIndex] ?? [];
    const beforeNotes = before.textNotesByPage[pageIndex] ?? [];
    const afterStrokes = after.strokesByPage[pageIndex] ?? [];
    const afterNotes = after.textNotesByPage[pageIndex] ?? [];
    if (beforeStrokes === afterStrokes && beforeNotes === afterNotes) {
      continue;
    }
    const beforeValues = [...beforeStrokes, ...beforeNotes];
    const afterValues = [...afterStrokes, ...afterNotes];
    const beforeById = new Map(beforeValues.map((value) => [value.id, value]));
    const afterIds = new Set(afterValues.map((value) => value.id));

    for (const value of beforeValues) {
      if (!afterIds.has(value.id)) {
        changes.push({
          kind: 'delete',
          pageIndex,
          annotationId: value.id,
        });
      }
    }
    for (const stroke of afterStrokes) {
      const beforeStroke = beforeById.get(stroke.id);
      if (beforeStroke !== stroke && !valuesEqual(beforeStroke, stroke)) {
        changes.push({ kind: 'upsert-stroke', pageIndex, stroke });
      }
    }
    for (const note of afterNotes) {
      const beforeNote = beforeById.get(note.id);
      if (beforeNote !== note && !valuesEqual(beforeNote, note)) {
        changes.push({ kind: 'upsert-text-note', pageIndex, note });
      }
    }
  }

  return changes;
};
