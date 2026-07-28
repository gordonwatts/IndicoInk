import { describe, expect, it } from 'vitest';

import type { InkStroke } from './strokeTools';
import {
  createWorkspaceHistory,
  createWorkspaceHistoryEntry,
  MAX_WORKSPACE_HISTORY_ENTRIES,
  migrateLegacyWorkspaceHistory,
  pushWorkspaceHistory,
  redoWorkspaceHistory,
  undoWorkspaceHistory,
  type WorkspacePages,
} from './workspaceHistory';

const stroke = (id: string, x = 0.1): InkStroke => ({
  id,
  pageNumber: 1,
  points: [{ x, y: 0.2, pressure: 0.5, time: 1 }],
});

const pages = (strokes: InkStroke[] = []): WorkspacePages => ({
  strokesByPage: [strokes],
  textNotesByPage: [[]],
});

describe('compact workspace history', () => {
  it('stores and inverts page-local additions', () => {
    const before = pages();
    const after = pages([stroke('stroke-1')]);
    const entry = createWorkspaceHistoryEntry(before, after);
    expect(entry?.changes).toHaveLength(1);
    expect(entry?.changes[0]).toMatchObject({
      kind: 'stroke',
      pageIndex: 0,
      annotationId: 'stroke-1',
      before: null,
    });

    const history = pushWorkspaceHistory(createWorkspaceHistory(), entry!);
    const undone = undoWorkspaceHistory(after, history);
    expect(undone?.pages.strokesByPage).toEqual([[]]);
    const redone = redoWorkspaceHistory(undone!.pages, undone!.history);
    expect(redone?.pages.strokesByPage[0]?.[0]?.id).toBe('stroke-1');
  });

  it('caps undo and redo history at 200 actions', () => {
    let history = createWorkspaceHistory();
    for (let index = 0; index < 220; index += 1) {
      history = pushWorkspaceHistory(history, {
        id: `entry-${index}`,
        changes: [],
      });
    }
    expect(history.undo).toHaveLength(MAX_WORKSPACE_HISTORY_ENTRIES);
    expect(history.undo[0]?.id).toBe('entry-219');
    expect(history.undo.at(-1)?.id).toBe('entry-20');
  });

  it('converts adjacent legacy snapshots without changing current ink', () => {
    const current = pages([stroke('current', 0.4)]);
    const legacy = migrateLegacyWorkspaceHistory(current, [
      [
        {
          strokes: [stroke('previous', 0.2)],
          textNotes: [],
        },
      ],
    ]);
    expect(legacy.undo).toHaveLength(1);
    const undone = undoWorkspaceHistory(current, legacy);
    expect(undone?.pages.strokesByPage[0]?.[0]?.id).toBe('previous');
    expect(current.strokesByPage[0]?.[0]?.id).toBe('current');
  });
});
