import { describe, expect, it } from 'vitest';

import { diffWorkspaceAnnotations } from './workspaceChanges';

describe('workspace change batches', () => {
  it('emits only changes from touched pages', () => {
    const untouched = {
      id: 'untouched',
      pageNumber: 1,
      points: [{ x: 0.1, y: 0.1, pressure: 0.5, time: 1 }],
    };
    const before = {
      strokesByPage: [[untouched], []],
      textNotesByPage: [[], []],
    };
    const added = {
      id: 'added',
      pageNumber: 2,
      points: [{ x: 0.5, y: 0.5, pressure: 0.5, time: 2 }],
    };
    const after = {
      strokesByPage: [before.strokesByPage[0]!, [added]],
      textNotesByPage: before.textNotesByPage,
    };

    expect(diffWorkspaceAnnotations(before, after)).toEqual([
      { kind: 'upsert-stroke', pageIndex: 1, stroke: added },
    ]);
  });
});
