import { constants, existsSync, mkdirSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementResultingChanges,
  type StatementSync,
} from 'node:sqlite';

import type { NormalizedPagePoint } from './inkGeometry';
import { DEFAULT_PEN_THICKNESS } from './strokeTools';
import type { InkStroke } from './strokeTools';
import type {
  Annotation,
  Conference,
  Deck,
  PenStroke,
  Slide,
  Talk,
  TextNote,
  ViewState,
} from './persistenceModels';
import type {
  PdfWorkspaceChangeBatch,
  PdfWorkspaceChangeSaveResult,
  PdfWorkspaceHistory,
  PdfWorkspaceSaveResult,
  PdfWorkspaceSnapshot,
  PdfWorkspacePageState,
  WorkspaceHistoryEntry,
} from './shared/pdfWorkspace';
import {
  canonicalJson,
  createOperation,
  isCredentialFreeMetadataUrl,
  isShareableSourceUrl,
  isUuid,
  validateCatalog,
  type SyncCatalog,
  type SyncOperation,
} from './syncProtocol';
import {
  mergeAnnotationOperations,
  mergeBookmarkState,
  causallyReadyMetadataOperations,
  mergeConcurrentConferenceDeletion,
  mergeMetadataRefreshes,
} from './syncMerge';
import {
  createConferenceId,
  createDeckId,
  createNotebookDeckId,
  createSlideId,
  createTalkId,
  createViewStateId,
} from './persistenceModels';

const CURRENT_SCHEMA_VERSION = 16;
const PRE_NODE_SQLITE_BACKUP_SUFFIX = '.pre-node-sqlite-v7.bak';

const getFileName = (value: string) => {
  const normalized = value.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

const toBoolean = (value: unknown) => value === 1 || value === true;

const serializeStrokePayload = (
  points: NormalizedPagePoint[],
  baseWidth?: number,
  color?: string,
) => JSON.stringify({ points, baseWidth, color });

const createEmptyPageState = (): PdfWorkspacePageState => ({
  strokes: [],
  textNotes: [],
});

const serializeWorkspaceHistory = (history: PdfWorkspacePageState[][]) =>
  JSON.stringify(history);

const parseWorkspaceHistoryEntry = (value: string) => {
  try {
    const parsed = JSON.parse(value) as Partial<WorkspaceHistoryEntry>;
    return typeof parsed.id === 'string' && Array.isArray(parsed.changes)
      ? (parsed as WorkspaceHistoryEntry)
      : null;
  } catch {
    return null;
  }
};

const isStrokeCandidate = (
  value: unknown,
): value is Partial<InkStroke> & { id: string; pageNumber: number } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).id === 'string' &&
  typeof (value as Record<string, unknown>).pageNumber === 'number' &&
  Array.isArray((value as Record<string, unknown>).points);

const isTextNoteCandidate = (
  value: unknown,
): value is Partial<TextNote> & { id: string; slideId: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).id === 'string' &&
  typeof (value as Record<string, unknown>).slideId === 'string' &&
  typeof (value as Record<string, unknown>).x === 'number' &&
  typeof (value as Record<string, unknown>).y === 'number' &&
  typeof (value as Record<string, unknown>).text === 'string';

const normalizeStroke = (stroke: unknown): InkStroke | null => {
  if (!isStrokeCandidate(stroke)) {
    return null;
  }

  const candidate = stroke as {
    id: string;
    pageNumber: number;
    baseWidth?: unknown;
    color?: unknown;
    points: Array<unknown>;
  };
  const points = candidate.points.filter(
    (point): point is NormalizedPagePoint =>
      typeof point === 'object' &&
      point !== null &&
      typeof (point as Record<string, unknown>).x === 'number' &&
      typeof (point as Record<string, unknown>).y === 'number' &&
      typeof (point as Record<string, unknown>).pressure === 'number' &&
      typeof (point as Record<string, unknown>).time === 'number',
  );

  return {
    id: candidate.id,
    pageNumber: candidate.pageNumber,
    ...(typeof candidate.baseWidth === 'number' &&
    Number.isFinite(candidate.baseWidth)
      ? { baseWidth: candidate.baseWidth }
      : {}),
    ...(typeof candidate.color === 'string' && candidate.color.trim()
      ? { color: candidate.color }
      : {}),
    points,
  };
};

const normalizeTextNote = (note: unknown): TextNote | null => {
  if (!isTextNoteCandidate(note)) {
    return null;
  }

  const candidate = note as {
    id: string;
    conferenceId?: string;
    talkId?: string;
    deckId?: string;
    slideId: string;
    x: number;
    y: number;
    width?: number;
    text: string;
    createdAt?: number;
    updatedAt?: number;
  };

  return {
    id: candidate.id,
    conferenceId: String(candidate.conferenceId ?? ''),
    talkId: String(candidate.talkId ?? ''),
    deckId: String(candidate.deckId ?? ''),
    slideId: candidate.slideId,
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    text: candidate.text,
    createdAt: Number(candidate.createdAt ?? 0),
    updatedAt: Number(candidate.updatedAt ?? 0),
  };
};

const normalizePageState = (value: unknown): PdfWorkspacePageState => {
  if (!value || typeof value !== 'object') {
    return createEmptyPageState();
  }

  const candidate = value as Partial<PdfWorkspacePageState>;
  return {
    strokes: Array.isArray(candidate.strokes)
      ? candidate.strokes
          .map(normalizeStroke)
          .filter((stroke): stroke is InkStroke => stroke !== null)
      : [],
    textNotes: Array.isArray(candidate.textNotes)
      ? candidate.textNotes
          .map(normalizeTextNote)
          .filter((note): note is TextNote => note !== null)
      : [],
  } as PdfWorkspacePageState;
};

const deserializeStrokePayload = (
  value: string,
): { points: NormalizedPagePoint[]; baseWidth: number; color?: string } =>
  (() => {
    try {
      const parsed = JSON.parse(value) as unknown;
      const pointsValue = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && 'points' in parsed
          ? (parsed as { points?: unknown }).points
          : null;
      if (!Array.isArray(pointsValue)) {
        return { points: [], baseWidth: DEFAULT_PEN_THICKNESS };
      }

      const points = pointsValue.filter(
        (point): point is NormalizedPagePoint =>
          typeof point === 'object' &&
          point !== null &&
          typeof (point as Record<string, unknown>).x === 'number' &&
          typeof (point as Record<string, unknown>).y === 'number' &&
          typeof (point as Record<string, unknown>).pressure === 'number' &&
          typeof (point as Record<string, unknown>).time === 'number',
      );
      const parsedBaseWidth =
        parsed && typeof parsed === 'object' && 'baseWidth' in parsed
          ? (parsed as { baseWidth?: unknown }).baseWidth
          : DEFAULT_PEN_THICKNESS;
      const parsedColor =
        parsed && typeof parsed === 'object' && 'color' in parsed
          ? (parsed as { color?: unknown }).color
          : undefined;

      return {
        points,
        baseWidth:
          typeof parsedBaseWidth === 'number' &&
          Number.isFinite(parsedBaseWidth)
            ? parsedBaseWidth
            : DEFAULT_PEN_THICKNESS,
        ...(typeof parsedColor === 'string' && parsedColor.trim()
          ? { color: parsedColor }
          : {}),
      };
    } catch {
      return { points: [], baseWidth: DEFAULT_PEN_THICKNESS };
    }
  })();

const deserializeWorkspaceHistory = (
  value: string | null | undefined,
): PdfWorkspacePageState[][] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((entry) => {
      if (Array.isArray(entry)) {
        if (entry.length === 0) {
          return [];
        }

        if (Array.isArray(entry[0])) {
          return entry.map((page) => ({
            strokes: Array.isArray(page)
              ? page.map(normalizeStroke).filter(Boolean)
              : [],
            textNotes: [],
          })) as PdfWorkspacePageState[];
        }

        if (typeof entry[0] === 'object' && entry[0] !== null) {
          return entry.map((page) => normalizePageState(page));
        }
      }

      if (!entry || typeof entry !== 'object') {
        return [createEmptyPageState()];
      }

      const candidate = entry as Record<string, unknown>;
      if (
        Array.isArray(candidate.strokes) ||
        Array.isArray(candidate.textNotes)
      ) {
        return [normalizePageState(entry)];
      }

      return [createEmptyPageState()];
    });
  } catch {
    return [];
  }
};

const migration1 = (db: SqliteDatabaseAdapter) => {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_meta (
      version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conferences (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      dates TEXT NOT NULL,
      host TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'indico',
      time_zone TEXT,
      last_opened_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS talks (
      id TEXT PRIMARY KEY,
      conference_id TEXT NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      contribution_id TEXT NOT NULL,
      contribution_url TEXT NOT NULL,
      title TEXT NOT NULL,
      speaker TEXT NOT NULL,
      session_title TEXT NOT NULL,
      starts_at INTEGER,
      ends_at INTEGER,
      room TEXT NOT NULL,
      bookmarked INTEGER NOT NULL DEFAULT 0,
      upstream_status TEXT NOT NULL DEFAULT 'present',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(conference_id, contribution_id)
    );

    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      conference_id TEXT NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      talk_id TEXT NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      display_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 0,
      upstream_status TEXT NOT NULL DEFAULT 'present',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(talk_id, source_url)
    );

    CREATE TABLE IF NOT EXISTS slides (
      id TEXT PRIMARY KEY,
      conference_id TEXT NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      talk_id TEXT NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      slide_number INTEGER NOT NULL,
      annotated INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(deck_id, slide_number)
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      conference_id TEXT NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      talk_id TEXT NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      slide_id TEXT NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS view_state (
      id TEXT PRIMARY KEY,
      conference_id TEXT NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      talk_id TEXT NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      slide_id TEXT,
      current_slide_number INTEGER NOT NULL,
      zoom REAL NOT NULL,
      scroll_left REAL NOT NULL,
      scroll_top REAL NOT NULL,
      undo_stack_json TEXT NOT NULL DEFAULT '[]',
      redo_stack_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(conference_id, talk_id, deck_id)
    );

    CREATE INDEX IF NOT EXISTS idx_talks_conference_id ON talks(conference_id);
    CREATE INDEX IF NOT EXISTS idx_decks_talk_id ON decks(talk_id);
    CREATE INDEX IF NOT EXISTS idx_slides_deck_id ON slides(deck_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_slide_id ON annotations(slide_id);
    CREATE INDEX IF NOT EXISTS idx_view_state_deck_id ON view_state(deck_id);
  `);
};

const migration2 = (db: SqliteDatabaseAdapter) => {
  const columns = new Set(
    (
      db.pragma('table_info(view_state)') as Array<{
        columns: string[];
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );

  if (!columns.has('undo_stack_json')) {
    db.exec(
      "ALTER TABLE view_state ADD COLUMN undo_stack_json TEXT NOT NULL DEFAULT '[]';",
    );
  }

  if (!columns.has('redo_stack_json')) {
    db.exec(
      "ALTER TABLE view_state ADD COLUMN redo_stack_json TEXT NOT NULL DEFAULT '[]';",
    );
  }
};

const migration3 = (db: SqliteDatabaseAdapter) => {
  const columns = new Set(
    (
      db.pragma('table_info(talks)') as Array<{
        columns: string[];
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );

  if (!columns.has('contribution_url')) {
    db.exec(
      'ALTER TABLE talks ADD COLUMN contribution_url TEXT NOT NULL DEFAULT "";',
    );
  }

  db.exec(`
    UPDATE talks
    SET contribution_url = COALESCE(
      NULLIF(contribution_url, ''),
      (
        SELECT source_url
        FROM conferences
        WHERE conferences.id = talks.conference_id
      ) || '/contributions/' || contribution_id || '/'
    )
    WHERE contribution_url IS NULL OR contribution_url = '';
  `);
};

const migration4 = (db: SqliteDatabaseAdapter) => {
  const talkColumns = new Set(
    (
      db.pragma('table_info(talks)') as Array<{
        columns: string[];
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );

  if (!talkColumns.has('upstream_status')) {
    db.exec(
      "ALTER TABLE talks ADD COLUMN upstream_status TEXT NOT NULL DEFAULT 'present';",
    );
  }

  const deckColumns = new Set(
    (
      db.pragma('table_info(decks)') as Array<{
        columns: string[];
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );

  if (!deckColumns.has('upstream_status')) {
    db.exec(
      "ALTER TABLE decks ADD COLUMN upstream_status TEXT NOT NULL DEFAULT 'present';",
    );
  }
};

const migration5 = (db: SqliteDatabaseAdapter) => {
  const columns = new Set(
    (
      db.pragma('table_info(talks)') as Array<{ values: Array<Array<unknown>> }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );
  if (!columns.has('entry_kind')) {
    db.exec(
      "ALTER TABLE talks ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'talk';",
    );
  }
  if (!columns.has('linked_agenda_url')) {
    db.exec(
      'ALTER TABLE talks ADD COLUMN linked_agenda_url TEXT NOT NULL DEFAULT "";',
    );
  }
};

const migration6 = (db: SqliteDatabaseAdapter) => {
  const columns = new Set(
    (
      db.pragma('table_info(conferences)') as Array<{
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );

  if (!columns.has('time_zone')) {
    db.exec('ALTER TABLE conferences ADD COLUMN time_zone TEXT;');
  }
};

const migration7 = (db: SqliteDatabaseAdapter) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_history (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      stack TEXT NOT NULL CHECK(stack IN ('undo', 'redo')),
      position INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(deck_id, stack, position)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_history_deck_stack
      ON workspace_history(deck_id, stack, position);

    CREATE TABLE IF NOT EXISTS workspace_revision (
      deck_id TEXT PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
};

const migration8 = (db: SqliteDatabaseAdapter) => {
  const decksTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'decks'",
    )
    .get();
  if (!decksTable) {
    return;
  }

  const columns = new Set(
    (
      db.pragma('table_info(decks)') as Array<{
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );

  if (!columns.has('kind')) {
    db.exec("ALTER TABLE decks ADD COLUMN kind TEXT NOT NULL DEFAULT 'pdf';");
  }
};

const migration9 = (db: SqliteDatabaseAdapter) => {
  const columns = new Set(
    (
      db.pragma('table_info(conferences)') as Array<{
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );

  if (!columns.has('source_kind')) {
    db.exec(
      "ALTER TABLE conferences ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'indico';",
    );
  }
};

const migration10 = (db: SqliteDatabaseAdapter) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_profile (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      library_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      workspace_id TEXT,
      folder_path TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_stream_state (
      stream_id TEXT PRIMARY KEY,
      next_sequence INTEGER NOT NULL DEFAULT 1,
      local_frontier_json TEXT NOT NULL DEFAULT '{}',
      remote_frontier_json TEXT NOT NULL DEFAULT '{}',
      snapshot_id TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      operation_id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      operation_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      published_at INTEGER,
      UNIQUE(stream_id, device_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending
      ON sync_outbox(state, stream_id, sequence);

    CREATE TABLE IF NOT EXISTS sync_inbox (
      operation_id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      operation_json TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'discovered',
      discovered_at INTEGER NOT NULL,
      applied_at INTEGER,
      UNIQUE(stream_id, device_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_sync_inbox_stream
      ON sync_inbox(stream_id, state, device_id, sequence);

    CREATE TABLE IF NOT EXISTS sync_conflicts (
      conflict_id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      conflict_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open
      ON sync_conflicts(resolved_at, stream_id);

    CREATE TABLE IF NOT EXISTS sync_catalog_state (
      device_id TEXT PRIMARY KEY,
      generation INTEGER NOT NULL DEFAULT 0,
      catalog_json TEXT,
      validated_at INTEGER,
      retired_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sync_checkpoints (
      stream_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      frontier_json TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      validated_at INTEGER NOT NULL,
      PRIMARY KEY(stream_id, snapshot_id)
    );

    CREATE TABLE IF NOT EXISTS sync_document_versions (
      deck_id TEXT PRIMARY KEY,
      document_version TEXT,
      version_state TEXT NOT NULL DEFAULT 'unknown',
      measured_at INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_annotation_versions (
      annotation_id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      document_version TEXT,
      version_state TEXT NOT NULL DEFAULT 'unknown',
      association_operation_id TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_retirements (
      retirement_id TEXT PRIMARY KEY,
      retired_device_id TEXT NOT NULL,
      issued_by TEXT NOT NULL,
      retirement_json TEXT NOT NULL,
      validated_at INTEGER NOT NULL
    );
  `);

  const profile = db
    .prepare('SELECT singleton_id FROM sync_profile WHERE singleton_id = 1')
    .get();
  if (!profile) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO sync_profile (singleton_id, library_id, device_id, created_at, updated_at)
       VALUES (1, @libraryId, @deviceId, @now, @now)`,
    ).run({ libraryId: randomUUID(), deviceId: randomUUID(), now });
  }

  // Existing annotations predate PDF byte identity. Record them as unknown so a
  // later download cannot silently assign them to a different PDF revision.
  // Some older fixture databases intentionally contain only a subset of tables.
  const hasDecks = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'decks'",
    )
    .get();
  if (hasDecks) {
    db.exec(`
      INSERT OR IGNORE INTO sync_document_versions (
        deck_id, document_version, version_state, measured_at, updated_at
      )
      SELECT id, NULL, 'unknown', NULL, updated_at
      FROM decks
      WHERE kind = 'pdf';
    `);

    const hasAnnotations = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'annotations'",
      )
      .get();
    if (hasAnnotations) {
      db.exec(`
        INSERT OR IGNORE INTO sync_annotation_versions (
          annotation_id, deck_id, document_version, version_state,
          association_operation_id, updated_at
        )
        SELECT annotations.id, annotations.deck_id, NULL, 'unknown', NULL,
               annotations.updated_at
        FROM annotations
        INNER JOIN decks ON decks.id = annotations.deck_id
        WHERE decks.kind = 'pdf';
      `);
    }
  }
};

const migration11 = (db: SqliteDatabaseAdapter) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_legacy_version_migration (
      deck_id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'pending',
      updated_at INTEGER NOT NULL
    );
  `);
  const hasDecks = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'decks'",
    )
    .get();
  if (hasDecks) {
    db.prepare(
      `INSERT OR IGNORE INTO sync_legacy_version_migration (deck_id, state, updated_at)
       SELECT id, 'pending', updated_at FROM decks WHERE kind = 'pdf'`,
    ).run();
  }
};

const migration12 = (db: SqliteDatabaseAdapter) => {
  const columns = new Set(
    (
      db.pragma('table_info(sync_profile)') as Array<{
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );
  if (!columns.has('scan_queue_json')) {
    db.exec(
      "ALTER TABLE sync_profile ADD COLUMN scan_queue_json TEXT NOT NULL DEFAULT '[]';",
    );
  }
};

const migration13 = (db: SqliteDatabaseAdapter) => {
  const columns = new Set(
    (
      db.pragma('table_info(sync_catalog_state)') as Array<{
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );
  if (columns.has('workspace_id')) return;
  db.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE sync_catalog_state RENAME TO sync_catalog_state_v12;
    CREATE TABLE sync_catalog_state (
      workspace_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 0,
      catalog_json TEXT,
      validated_at INTEGER,
      retired_at INTEGER,
      PRIMARY KEY(workspace_id, device_id)
    );
    INSERT INTO sync_catalog_state (
      workspace_id, device_id, generation, catalog_json, validated_at, retired_at
    )
    SELECT COALESCE((SELECT workspace_id FROM sync_profile WHERE singleton_id = 1), ''),
           device_id, generation, catalog_json, validated_at, retired_at
    FROM sync_catalog_state_v12;
    DROP TABLE sync_catalog_state_v12;
    COMMIT;
  `);
};

const migration15 = (db: SqliteDatabaseAdapter) => {
  const columns = new Set(
    (
      db.pragma('table_info(sync_outbox)') as Array<{
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );
  if (!columns.has('conference_id')) {
    const tables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<Record<string, unknown>>
      ).map((row) => String(row.name)),
    );
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE sync_outbox ADD COLUMN conference_id TEXT;
    `);
    if (tables.has('decks')) {
      db.exec(`
      UPDATE sync_outbox
      SET conference_id = (
        SELECT decks.conference_id
        FROM decks
        WHERE decks.id = substr(sync_outbox.stream_id, 43)
      )
      WHERE instr(sync_outbox.stream_id, ':deck:') > 0;
      UPDATE sync_outbox AS target
      SET conference_id = (
        SELECT json_extract(source.operation_json, '$.payload.annotation.conferenceId')
        FROM sync_outbox AS source
        WHERE source.stream_id = target.stream_id
          AND json_extract(source.operation_json, '$.payload.annotation.conferenceId') IS NOT NULL
        ORDER BY source.sequence
        LIMIT 1
      )
      WHERE target.conference_id IS NULL
        AND instr(target.stream_id, ':deck:') > 0;
      `);
    }
    db.exec(`
      COMMIT;
    `);
  }
};

const migration16 = (db: SqliteDatabaseAdapter) => {
  const columns = new Set(
    (
      db.pragma('table_info(sync_profile)') as Array<{
        values: Array<Array<unknown>>;
      }>
    ).flatMap((result) => result.values.map((row) => String(row[1]))),
  );
  if (!columns.has('last_folder_path')) {
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE sync_profile ADD COLUMN last_folder_path TEXT;
      UPDATE sync_profile SET last_folder_path = folder_path
      WHERE folder_path IS NOT NULL;
      COMMIT;
    `);
  }
};

const migrations = [
  migration1,
  migration2,
  migration3,
  migration4,
  migration5,
  migration6,
  migration7,
  migration8,
  migration9,
  migration10,
  migration11,
  migration12,
  migration13,
  (db: SqliteDatabaseAdapter) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_hidden_conferences (
        workspace_id TEXT NOT NULL,
        conference_id TEXT NOT NULL,
        hidden_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, conference_id)
      );
      CREATE TABLE IF NOT EXISTS sync_suppressed_annotations (
        workspace_id TEXT NOT NULL,
        annotation_id TEXT NOT NULL,
        suppressed_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, annotation_id)
      );
    `);
  },
  migration15,
  migration16,
];

export type SyncProfile = {
  libraryId: string;
  deviceId: string;
  workspaceId: string | null;
  folderPath: string | null;
  lastFolderPath: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SyncOutboxEntry = {
  operation: SyncOperation;
  conferenceId: string | null;
  state: 'pending' | 'published';
  createdAt: number;
  publishedAt: number | null;
};

const rowToConference = (row: Record<string, unknown>): Conference => ({
  id: String(row.id),
  sourceUrl: String(row.source_url),
  title: String(row.title),
  dates: String(row.dates),
  host: String(row.host),
  sourceKind: row.source_kind === 'web' ? 'web' : 'indico',
  timeZone:
    row.time_zone === null || row.time_zone === undefined
      ? null
      : String(row.time_zone),
  lastOpenedAt:
    row.last_opened_at === null || row.last_opened_at === undefined
      ? null
      : Number(row.last_opened_at),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

const rowToTalk = (row: Record<string, unknown>): Talk => ({
  id: String(row.id),
  conferenceId: String(row.conference_id),
  contributionId: String(row.contribution_id),
  contributionUrl: String(row.contribution_url),
  title: String(row.title),
  speaker: String(row.speaker),
  sessionTitle: String(row.session_title),
  startsAt:
    row.starts_at === null || row.starts_at === undefined
      ? null
      : Number(row.starts_at),
  endsAt:
    row.ends_at === null || row.ends_at === undefined
      ? null
      : Number(row.ends_at),
  room: String(row.room),
  bookmarked: toBoolean(row.bookmarked),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
  upstreamStatus: String(row.upstream_status ?? 'present') as
    | 'present'
    | 'changed'
    | 'missing',
  entryKind: String(row.entry_kind ?? 'talk') as 'talk' | 'linked-agenda',
  linkedAgendaUrl: String(row.linked_agenda_url ?? ''),
});

const rowToDeck = (row: Record<string, unknown>): Deck => ({
  id: String(row.id),
  conferenceId: String(row.conference_id),
  talkId: String(row.talk_id),
  sourceUrl: String(row.source_url),
  displayName: String(row.display_name),
  mimeType: String(row.mime_type),
  selected: toBoolean(row.selected),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
  kind: String(row.kind ?? 'pdf') as 'pdf' | 'other' | 'notebook',
  upstreamStatus: String(row.upstream_status ?? 'present') as
    | 'present'
    | 'changed'
    | 'missing',
});

const rowToSlide = (row: Record<string, unknown>): Slide => ({
  id: String(row.id),
  conferenceId: String(row.conference_id),
  talkId: String(row.talk_id),
  deckId: String(row.deck_id),
  slideNumber: Number(row.slide_number),
  annotated: toBoolean(row.annotated),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

const rowToAnnotation = (row: Record<string, unknown>): Annotation => {
  const kind = String(row.kind);
  const createdAt = Number(row.created_at);
  const updatedAt = Number(row.updated_at);
  const base = {
    id: String(row.id),
    conferenceId: String(row.conference_id),
    talkId: String(row.talk_id),
    deckId: String(row.deck_id),
    slideId: String(row.slide_id),
    createdAt,
    updatedAt,
  };

  if (kind === 'text') {
    try {
      const payload = JSON.parse(String(row.payload_json)) as Partial<TextNote>;

      return {
        ...base,
        x: Number(payload.x ?? 0),
        y: Number(payload.y ?? 0),
        width:
          typeof payload.width === 'number' && Number.isFinite(payload.width)
            ? payload.width
            : undefined,
        text: typeof payload.text === 'string' ? payload.text : '',
      };
    } catch {
      return {
        ...base,
        x: 0,
        y: 0,
        text: '',
      };
    }
  }

  return {
    ...base,
    ...deserializeStrokePayload(String(row.payload_json)),
  };
};

type StoredViewState = ViewState & {
  undoStack: PdfWorkspacePageState[][];
  redoStack: PdfWorkspacePageState[][];
};

type ViewStateRecord = ViewState & {
  undoStack?: PdfWorkspacePageState[][];
  redoStack?: PdfWorkspacePageState[][];
};

const rowToViewState = (row: Record<string, unknown>): StoredViewState => ({
  id: String(row.id),
  conferenceId: String(row.conference_id),
  talkId: String(row.talk_id),
  deckId: String(row.deck_id),
  slideId:
    row.slide_id === null || row.slide_id === undefined
      ? null
      : String(row.slide_id),
  currentSlideNumber: Number(row.current_slide_number),
  zoom: Number(row.zoom),
  scrollLeft: Number(row.scroll_left),
  scrollTop: Number(row.scroll_top),
  undoStack: deserializeWorkspaceHistory(
    typeof row.undo_stack_json === 'string' ? row.undo_stack_json : '[]',
  ),
  redoStack: deserializeWorkspaceHistory(
    typeof row.redo_stack_json === 'string' ? row.redo_stack_json : '[]',
  ),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

class SqliteStatementAdapter {
  constructor(
    private readonly statement: StatementSync,
    private readonly parameterNames: Set<string>,
  ) {}

  run(params?: unknown) {
    const result = invokeStatement(
      this.statement,
      'run',
      params,
      this.parameterNames,
    ) as StatementResultingChanges;
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  get(params?: unknown) {
    const row = invokeStatement(
      this.statement,
      'get',
      params,
      this.parameterNames,
    ) as Record<string, unknown> | undefined;
    return row && Object.keys(row).length ? row : undefined;
  }

  all(params?: unknown) {
    return invokeStatement(
      this.statement,
      'all',
      params,
      this.parameterNames,
    ) as Record<string, unknown>[];
  }
}

class SqliteDatabaseAdapter {
  constructor(private readonly db: DatabaseSync) {}

  pragma<T = unknown>(statement: string, options?: { simple?: boolean }): T {
    const trimmed = statement.trim();
    const sql = trimmed.toUpperCase().startsWith('PRAGMA')
      ? trimmed.endsWith(';')
        ? trimmed
        : `${trimmed};`
      : `PRAGMA ${trimmed};`;
    const prepared = this.db.prepare(sql);
    const rows = prepared.all() as Record<string, unknown>[];

    if (options?.simple) {
      const firstRow = rows[0];
      return (firstRow ? Object.values(firstRow)[0] : 0) as T;
    }

    const columns = rows[0] ? Object.keys(rows[0]) : [];
    return [
      {
        columns,
        values: rows.map((row) => columns.map((column) => row[column])),
      },
    ] as T;
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  prepare(sql: string) {
    return new SqliteStatementAdapter(
      this.db.prepare(sql),
      new Set(sql.match(/[@:$][A-Za-z_][A-Za-z0-9_]*/g) ?? []),
    );
  }

  transaction<T>(work: () => T): () => T {
    return () => {
      this.exec('BEGIN TRANSACTION');
      try {
        const result = work();
        this.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.exec('ROLLBACK');
        } catch {
          // Ignore rollback failures.
        }
        throw error;
      }
    };
  }

  close() {
    this.db.close();
  }
}

const getStatementValue = (
  statement: SqliteStatementAdapter,
  params?: unknown,
) => {
  const row = statement.get(params);
  if (!row) {
    return null;
  }

  return row;
};

const toSqlInputValue = (value: unknown): SQLInputValue => {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'string'
  ) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return value as SQLInputValue;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  return String(value);
};

const normalizeParams = (
  params?: unknown,
): SQLInputValue[] | Record<string, SQLInputValue> | undefined => {
  if (params === null || params === undefined) {
    return undefined;
  }

  if (Array.isArray(params)) {
    return params.map((value) => toSqlInputValue(value ?? null));
  }

  if (typeof params === 'object') {
    return Object.fromEntries(
      Object.entries(params as Record<string, unknown>).map(([key, value]) => [
        /^[@:$]/.test(key) ? key : `@${key}`,
        toSqlInputValue(value ?? null),
      ]),
    );
  }

  return [toSqlInputValue(params)];
};

const invokeStatement = (
  statement: StatementSync,
  method: 'run' | 'get' | 'all',
  params?: unknown,
  parameterNames: Set<string> = new Set(),
) => {
  const normalizedParams = normalizeParams(params);
  if (normalizedParams === undefined) {
    return statement[method]();
  }

  if (Array.isArray(normalizedParams)) {
    return statement[method](...normalizedParams);
  }

  const namedParameters = Object.fromEntries(
    Object.entries(normalizedParams).filter(([key]) => parameterNames.has(key)),
  );
  return statement[method](namedParameters);
};

export class PersistenceStore {
  private db: SqliteDatabaseAdapter | null = null;
  private loadPromise: Promise<void> | null = null;
  private transactionDepth = 0;

  constructor(
    private readonly dbPath: string,
    private readonly now = () => Date.now(),
  ) {}

  /**
   * Resolve the one-time legacy PDF migration before the viewer can display
   * annotations. A null hash records that the original cache was unavailable;
   * a later download must never silently claim that it was the original.
   */
  async bindLegacyDeckDocumentVersion(
    deckId: string,
    cachedDocumentVersion: string | null,
  ) {
    if (
      cachedDocumentVersion !== null &&
      !/^[0-9a-f]{64}$/.test(cachedDocumentVersion)
    ) {
      throw new Error('Cached PDF document version is invalid.');
    }
    const db = await this.getDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const migration = db
        .prepare(
          `SELECT state FROM sync_legacy_version_migration WHERE deck_id = ?`,
        )
        .get(deckId) as { state?: string } | undefined;
      if (migration?.state !== 'pending') {
        db.exec('COMMIT;');
        return false;
      }
      const now = this.now();
      db.prepare(
        `INSERT OR IGNORE INTO sync_document_versions (
           deck_id, document_version, version_state, measured_at, updated_at
         ) VALUES (?, NULL, 'unknown', NULL, ?)`,
      ).run([deckId, now]);
      db.prepare(
        `INSERT OR IGNORE INTO sync_annotation_versions (
           annotation_id, deck_id, document_version, version_state,
           association_operation_id, updated_at
         )
         SELECT id, deck_id, NULL, 'unknown', NULL, updated_at
         FROM annotations WHERE deck_id = ?`,
      ).run(deckId);
      if (cachedDocumentVersion) {
        db.prepare(
          `UPDATE sync_document_versions
           SET document_version = ?, version_state = 'known', measured_at = ?, updated_at = ?
           WHERE deck_id = ?`,
        ).run([cachedDocumentVersion, now, now, deckId]);
        db.prepare(
          `UPDATE sync_annotation_versions
           SET document_version = ?, version_state = 'known', updated_at = ?
           WHERE deck_id = ? AND document_version IS NULL AND version_state = 'unknown'`,
        ).run([cachedDocumentVersion, now, deckId]);
      }
      db.prepare(
        `UPDATE sync_legacy_version_migration SET state = ?, updated_at = ? WHERE deck_id = ?`,
      ).run([cachedDocumentVersion ? 'bound' : 'unknown', now, deckId]);
      this.markDirty();
      db.exec('COMMIT;');
      await this.flushIfNeeded();
      return true;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  /** Record bytes currently cached for newly created annotations without
   * changing legacy annotations that were deliberately left unknown. */
  async recordCurrentDeckDocumentVersion(
    deckId: string,
    documentVersion: string,
  ) {
    if (!/^[0-9a-f]{64}$/.test(documentVersion)) {
      throw new Error('Cached PDF document version is invalid.');
    }
    const db = await this.getDb();
    const now = this.now();
    db.prepare(
      `INSERT INTO sync_document_versions (
         deck_id, document_version, version_state, measured_at, updated_at
       ) VALUES (?, ?, 'known', ?, ?)
       ON CONFLICT(deck_id) DO UPDATE SET
         document_version = excluded.document_version,
         version_state = 'known', measured_at = excluded.measured_at,
         updated_at = excluded.updated_at`,
    ).run([deckId, documentVersion, now, now]);
    this.markDirty();
    await this.flushIfNeeded();
  }

  async associateUnknownAnnotationsWithDocumentVersion(
    deckId: string,
    annotationIds: string[],
    documentVersion: string,
  ) {
    if (
      !/^[0-9a-f]{64}$/.test(documentVersion) ||
      annotationIds.length === 0 ||
      annotationIds.length > 32 ||
      new Set(annotationIds).size !== annotationIds.length
    ) {
      throw new Error('Document-version association is invalid.');
    }
    const db = await this.getDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const update = db.prepare(
        `UPDATE sync_annotation_versions
         SET document_version = ?, version_state = 'known', updated_at = ?
         WHERE annotation_id = ? AND deck_id = ? AND version_state = 'unknown'`,
      );
      for (const annotationId of annotationIds) {
        const result = update.run([
          documentVersion,
          this.now(),
          annotationId,
          deckId,
        ]);
        if (Number(result.changes) !== 1) {
          throw new Error(
            `Annotation ${annotationId} is missing or already associated.`,
          );
        }
      }
      this.markDirty();
      db.exec('COMMIT;');
      await this.flushIfNeeded();
      return true;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  async getSyncProfile(): Promise<SyncProfile> {
    const db = await this.getDb();
    const row = db
      .prepare('SELECT * FROM sync_profile WHERE singleton_id = 1')
      .get() as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error('Sync profile is missing after database initialization.');
    }

    return {
      libraryId: String(row.library_id),
      deviceId: String(row.device_id),
      workspaceId:
        typeof row.workspace_id === 'string' ? row.workspace_id : null,
      folderPath: typeof row.folder_path === 'string' ? row.folder_path : null,
      lastFolderPath:
        typeof row.last_folder_path === 'string' ? row.last_folder_path : null,
      enabled: toBoolean(row.enabled),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async setSyncConfiguration(configuration: {
    workspaceId: string | null;
    folderPath: string | null;
    enabled: boolean;
  }) {
    if (
      (configuration.workspaceId !== null &&
        !isUuid(configuration.workspaceId)) ||
      (configuration.enabled &&
        (!configuration.workspaceId || !configuration.folderPath?.trim()))
    ) {
      throw new Error('Sync library configuration is invalid.');
    }
    const db = await this.getDb();
    const current = await this.getSyncProfile();
    db.prepare(
      `UPDATE sync_profile
       SET workspace_id = @workspaceId,
           folder_path = @folderPath,
           last_folder_path = CASE WHEN @folderPath IS NOT NULL
             THEN @folderPath ELSE last_folder_path END,
           enabled = @enabled,
           scan_queue_json = CASE WHEN @resetScanQueue THEN '[]' ELSE scan_queue_json END,
           updated_at = @updatedAt
       WHERE singleton_id = 1`,
    ).run({
      workspaceId: configuration.workspaceId,
      folderPath: configuration.folderPath?.trim() || null,
      enabled: configuration.enabled ? 1 : 0,
      resetScanQueue:
        current.workspaceId !== configuration.workspaceId ||
        current.folderPath !== (configuration.folderPath?.trim() || null)
          ? 1
          : 0,
      updatedAt: this.now(),
    });
    this.markDirty();
    await this.flushIfNeeded();
    return this.getSyncProfile();
  }

  async requeueSyncEligibleAnnotations() {
    const db = await this.getDb();
    const rows = db
      .prepare(
        `SELECT annotations.id FROM annotations
         INNER JOIN conferences ON conferences.id = annotations.conference_id
         INNER JOIN decks ON decks.id = annotations.deck_id
         WHERE conferences.source_kind IN ('indico', 'web')
           AND decks.kind <> 'notebook'
         ORDER BY annotations.id`,
      )
      .all() as Array<Record<string, unknown>>;
    await this.transaction(async () => {
      for (const row of rows) {
        const annotation = await this.getAnnotation(String(row.id));
        if (annotation) {
          this.recordLocalSyncAnnotationChange('annotation.put', annotation);
        }
      }
    });
    await this.flushIfNeeded();
    return rows.length;
  }

  async clearSyncEligibleAnnotations(
    workspaceId: string,
    alreadyPublishedOperationIds: ReadonlySet<string> = new Set(),
  ) {
    if (!isUuid(workspaceId)) throw new Error('Sync workspace ID is invalid.');
    const db = await this.getDb();
    await this.transaction(async () => {
      const annotationRows = db
        .prepare(
          `SELECT annotations.id AS annotation_id, annotations.deck_id
           FROM annotations
           INNER JOIN decks ON decks.id = annotations.deck_id
           INNER JOIN conferences ON conferences.id = decks.conference_id
           WHERE conferences.source_kind IN ('indico', 'web')
             AND decks.kind <> 'notebook'`,
        )
        .all() as Array<Record<string, unknown>>;
      const annotationIds = annotationRows.map((row) =>
        String(row.annotation_id),
      );
      const deckIds = [
        ...new Set(annotationRows.map((row) => String(row.deck_id))),
      ];
      for (const annotationId of annotationIds) {
        db.prepare(
          `INSERT INTO sync_suppressed_annotations (
             workspace_id, annotation_id, suppressed_at
           ) VALUES (?, ?, ?)
           ON CONFLICT(workspace_id, annotation_id) DO UPDATE SET
             suppressed_at = excluded.suppressed_at`,
        ).run([workspaceId, annotationId, this.now()]);
        db.prepare('DELETE FROM annotations WHERE id = ?').run(annotationId);
        db.prepare(
          'DELETE FROM sync_annotation_versions WHERE annotation_id = ?',
        ).run(annotationId);
      }
      for (const deckId of deckIds) {
        db.prepare('DELETE FROM workspace_history WHERE deck_id = ?').run(
          deckId,
        );
        db.prepare('DELETE FROM workspace_revision WHERE deck_id = ?').run(
          deckId,
        );
      }
      if (deckIds.length > 0) {
        const placeholders = deckIds.map(() => '?').join(', ');
        db.prepare(
          `UPDATE slides
           SET annotated = EXISTS (
             SELECT 1 FROM annotations WHERE annotations.slide_id = slides.id
           )
           WHERE deck_id IN (${placeholders})`,
        ).run(...deckIds);
      }
      const pendingOperations = db
        .prepare(
          `SELECT operation_id, stream_id, operation_json FROM sync_outbox
           WHERE state = 'pending' AND substr(stream_id, 1, ?) = ?`,
        )
        .all([`${workspaceId}:`.length, `${workspaceId}:`]) as Array<
        Record<string, unknown>
      >;
      for (const row of pendingOperations) {
        const operation = JSON.parse(
          String(row.operation_json),
        ) as SyncOperation;
        if (
          !String(row.stream_id).includes(':deck:') ||
          (operation.kind !== 'annotation.put' &&
            operation.kind !== 'annotation.erase')
        ) {
          continue;
        }
        const annotationId =
          operation.kind === 'annotation.put'
            ? String(
                (operation.payload.annotation as Record<string, unknown>).id,
              )
            : String(operation.payload.annotationId);
        db.prepare(
          `INSERT INTO sync_suppressed_annotations (
             workspace_id, annotation_id, suppressed_at
           ) VALUES (?, ?, ?)
           ON CONFLICT(workspace_id, annotation_id) DO UPDATE SET
             suppressed_at = excluded.suppressed_at`,
        ).run([workspaceId, annotationId, this.now()]);
        if (alreadyPublishedOperationIds.has(operation.operationId)) {
          db.prepare(
            `UPDATE sync_outbox SET state = 'published', published_at = ?
             WHERE operation_id = ? AND state = 'pending'`,
          ).run([this.now(), operation.operationId]);
          continue;
        }
        const { integrity: _integrity, ...fields } = operation;
        void _integrity;
        const noop = createOperation({ ...fields, kind: 'noop', payload: {} });
        db.prepare(
          "UPDATE sync_outbox SET operation_json = ? WHERE operation_id = ? AND state = 'pending'",
        ).run([canonicalJson(noop), operation.operationId]);
      }
      const prefix = `${workspaceId}:`;
      for (const table of ['sync_inbox', 'sync_conflicts']) {
        db.prepare(
          `DELETE FROM ${table} WHERE substr(stream_id, 1, ?) = ?`,
        ).run([prefix.length, prefix]);
      }
    });
    this.markDirty();
    await this.flushIfNeeded();
  }

  async getSyncScanQueue(): Promise<
    Array<{ relativeDirectory: string; lastName: string | null }>
  > {
    const db = await this.getDb();
    const row = db
      .prepare(
        'SELECT scan_queue_json FROM sync_profile WHERE singleton_id = 1',
      )
      .get() as { scan_queue_json?: string } | undefined;
    if (!row?.scan_queue_json) return [];
    const value: unknown = JSON.parse(row.scan_queue_json);
    if (
      !Array.isArray(value) ||
      value.length > 10_000 ||
      value.some(
        (cursor) =>
          !cursor ||
          typeof cursor !== 'object' ||
          typeof cursor.relativeDirectory !== 'string' ||
          (cursor.lastName !== null && typeof cursor.lastName !== 'string'),
      )
    ) {
      throw new Error('Saved sync scan progress is invalid.');
    }
    return value as Array<{
      relativeDirectory: string;
      lastName: string | null;
    }>;
  }

  async createSyncCatalog(): Promise<SyncCatalog | null> {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId) return null;
    const row = db
      .prepare(
        `SELECT generation, catalog_json FROM sync_catalog_state
         WHERE workspace_id = ? AND device_id = ?`,
      )
      .get([profile.workspaceId, profile.deviceId]) as
      | { generation?: number; catalog_json?: string | null }
      | undefined;
    const conferences = (await this.listConferences())
      .filter(
        (conference) =>
          (conference.sourceKind === 'indico' ||
            conference.sourceKind === 'web') &&
          isShareableSourceUrl(conference.sourceUrl),
      )
      .map((conference) => ({
        conferenceId: conference.id,
        sourceKind: conference.sourceKind ?? 'indico',
        sourceUrl: conference.sourceUrl,
        title: conference.title,
        dates: conference.dates,
        host: conference.host,
        metadataSnapshotId: null,
      }))
      .sort((left, right) =>
        left.conferenceId < right.conferenceId
          ? -1
          : left.conferenceId > right.conferenceId
            ? 1
            : 0,
      );
    if (row?.catalog_json) {
      const previous = validateCatalog(JSON.parse(row.catalog_json));
      if (
        previous.workspaceId === profile.workspaceId &&
        previous.deviceId === profile.deviceId &&
        canonicalJson(previous.conferences) === canonicalJson(conferences)
      ) {
        return previous;
      }
    }
    const generation = Number(row?.generation ?? 0) + 1;
    const catalog = validateCatalog({
      format: 'indicoink-catalog',
      version: 1,
      workspaceId: profile.workspaceId,
      deviceId: profile.deviceId,
      generation,
      updatedAt: this.now(),
      conferences,
    });
    const catalogJson = canonicalJson(catalog);
    db.prepare(
      `INSERT INTO sync_catalog_state (
         workspace_id, device_id, generation, catalog_json, validated_at,
         retired_at
       ) VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(workspace_id, device_id) DO UPDATE SET
         generation = excluded.generation,
         catalog_json = excluded.catalog_json,
         validated_at = excluded.validated_at`,
    ).run([
      profile.workspaceId,
      profile.deviceId,
      generation,
      catalogJson,
      this.now(),
    ]);
    this.markDirty();
    await this.flushIfNeeded();
    return catalog;
  }

  async applyRemoteSyncCatalog(input: unknown) {
    const catalog = validateCatalog(input);
    const profile = await this.getSyncProfile();
    if (catalog.workspaceId !== profile.workspaceId) {
      throw new Error('Catalog belongs to another sync library.');
    }
    if (catalog.deviceId === profile.deviceId) return false;
    const db = await this.getDb();
    const previous = db
      .prepare(
        `SELECT generation, catalog_json FROM sync_catalog_state
         WHERE workspace_id = ? AND device_id = ?`,
      )
      .get([catalog.workspaceId, catalog.deviceId]) as
      | { generation?: number; catalog_json?: string | null }
      | undefined;
    const serialized = canonicalJson(catalog);
    if (previous && Number(previous.generation) > catalog.generation)
      return false;
    if (
      previous &&
      Number(previous.generation) === catalog.generation &&
      previous.catalog_json !== serialized
    ) {
      throw new Error('A device catalog changed without advancing generation.');
    }
    if (
      previous &&
      Number(previous.generation) === catalog.generation &&
      previous.catalog_json === serialized
    ) {
      return false;
    }
    await this.transaction(async () => {
      for (const summary of catalog.conferences) {
        const locallyHidden = db
          .prepare(
            `SELECT 1 FROM sync_hidden_conferences
             WHERE workspace_id = ? AND conference_id = ?`,
          )
          .get([catalog.workspaceId, summary.conferenceId]);
        if (locallyHidden) continue;
        if (await this.getConference(summary.conferenceId)) continue;
        await this.upsertConference({
          id: summary.conferenceId,
          sourceUrl: summary.sourceUrl,
          title: summary.title,
          dates: summary.dates,
          host: summary.host,
          sourceKind: summary.sourceKind,
          timeZone: 'UTC',
          lastOpenedAt: catalog.updatedAt,
          createdAt: catalog.updatedAt,
          updatedAt: catalog.updatedAt,
        });
      }
      db.prepare(
        `INSERT INTO sync_catalog_state (
           workspace_id, device_id, generation, catalog_json, validated_at,
           retired_at
         ) VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(workspace_id, device_id) DO UPDATE SET
           generation = excluded.generation,
           catalog_json = excluded.catalog_json,
           validated_at = excluded.validated_at`,
      ).run([
        catalog.workspaceId,
        catalog.deviceId,
        catalog.generation,
        serialized,
        this.now(),
      ]);
    });
    return true;
  }

  async recordLocalSyncMetadataSnapshot(conferenceId: string) {
    const conference = await this.getConference(conferenceId);
    if (!conference || !isShareableSourceUrl(conference.sourceUrl)) return 0;
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId) return 0;
    const talks = await this.listTalksByConference(conferenceId);
    const decks = (await this.listDecksByConference(conferenceId)).filter(
      (deck) => deck.kind !== 'notebook',
    );
    if (
      talks.some(
        (talk) =>
          !isCredentialFreeMetadataUrl(talk.contributionId) ||
          !isCredentialFreeMetadataUrl(talk.contributionUrl) ||
          (talk.linkedAgendaUrl &&
            !isCredentialFreeMetadataUrl(talk.linkedAgendaUrl)),
      ) ||
      decks.some((deck) => !isShareableSourceUrl(deck.sourceUrl))
    ) {
      return 0;
    }
    const conferenceRecord = {
      id: conference.id,
      sourceUrl: conference.sourceUrl,
      title: conference.title,
      dates: conference.dates,
      host: conference.host,
      sourceKind: conference.sourceKind ?? 'indico',
      ...(conference.timeZone === undefined
        ? {}
        : { timeZone: conference.timeZone }),
      createdAt: conference.createdAt,
      updatedAt: conference.updatedAt,
    };
    const talkRecords = talks.map((talk) => ({
      id: talk.id,
      conferenceId: talk.conferenceId,
      contributionId: talk.contributionId,
      contributionUrl: talk.contributionUrl,
      title: talk.title,
      speaker: talk.speaker,
      sessionTitle: talk.sessionTitle,
      startsAt: talk.startsAt,
      endsAt: talk.endsAt,
      room: talk.room,
      createdAt: talk.createdAt,
      updatedAt: talk.updatedAt,
      ...(talk.upstreamStatus ? { upstreamStatus: talk.upstreamStatus } : {}),
      ...(talk.entryKind ? { entryKind: talk.entryKind } : {}),
      ...(talk.linkedAgendaUrl
        ? { linkedAgendaUrl: talk.linkedAgendaUrl }
        : {}),
    }));
    const deckRecords = decks.map((deck) => ({
      id: deck.id,
      conferenceId: deck.conferenceId,
      talkId: deck.talkId,
      sourceUrl: deck.sourceUrl,
      displayName: deck.displayName,
      mimeType: deck.mimeType,
      kind: deck.kind === 'other' ? 'other' : 'pdf',
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
      ...(deck.upstreamStatus ? { upstreamStatus: deck.upstreamStatus } : {}),
    }));
    const entities = [
      ...talkRecords.map((talk) => ({ kind: 'talk' as const, value: talk })),
      ...deckRecords.map((deck) => ({ kind: 'deck' as const, value: deck })),
    ];
    const chunks: Array<typeof entities> = [];
    for (let index = 0; index < entities.length; index += 32) {
      chunks.push(entities.slice(index, index + 32));
    }
    if (!chunks.length) chunks.push([]);
    const batchId = randomUUID();
    await this.transaction(async () => {
      for (let partIndex = 0; partIndex < chunks.length; partIndex += 1) {
        const part = chunks[partIndex]!;
        await this.recordLocalSyncOperation(
          `metadata:${conferenceId}`,
          conferenceId,
          'conference.metadata',
          {
            batchId,
            partIndex,
            partCount: chunks.length,
            conference: partIndex === 0 ? conferenceRecord : null,
            talks: part
              .filter((entity) => entity.kind === 'talk')
              .map((entity) => entity.value),
            decks: part
              .filter((entity) => entity.kind === 'deck')
              .map((entity) => entity.value),
            upstreamRevision: null,
          },
        );
      }
    });
    await this.flushIfNeeded();
    return chunks.length;
  }

  async requeueSyncEligibleMetadata() {
    const db = await this.getDb();
    const conferences = db
      .prepare(
        `SELECT id, source_url FROM conferences
         WHERE source_kind IN ('indico', 'web')
         ORDER BY id`,
      )
      .all() as Array<Record<string, unknown>>;
    const shareableConferences = conferences.filter((row) =>
      isShareableSourceUrl(String(row.source_url)),
    );
    for (const row of shareableConferences) {
      await this.recordLocalSyncMetadataSnapshot(String(row.id));
    }
    const bookmarkedTalks = db
      .prepare(
        `SELECT talks.id, talks.conference_id, conferences.source_url
         FROM talks
         INNER JOIN conferences ON conferences.id = talks.conference_id
         WHERE talks.bookmarked = 1
           AND conferences.source_kind IN ('indico', 'web')
         ORDER BY talks.id`,
      )
      .all() as Array<Record<string, unknown>>;
    const shareableBookmarks = bookmarkedTalks.filter((row) =>
      isShareableSourceUrl(String(row.source_url)),
    );
    await this.transaction(async () => {
      for (const row of shareableBookmarks) {
        await this.recordLocalSyncOperation(
          `metadata:${String(row.conference_id)}`,
          String(row.conference_id),
          'bookmark.set',
          { talkId: String(row.id), bookmarked: true },
        );
      }
    });
    await this.flushIfNeeded();
    return shareableConferences.length + shareableBookmarks.length;
  }

  async setSyncScanQueue(
    queue: Array<{ relativeDirectory: string; lastName: string | null }>,
  ) {
    if (queue.length > 10_000) {
      throw new Error('Sync scan progress exceeds its storage limit.');
    }
    const db = await this.getDb();
    db.prepare(
      `UPDATE sync_profile SET scan_queue_json = ?, updated_at = ?
       WHERE singleton_id = 1`,
    ).run([JSON.stringify(queue), this.now()]);
    this.markDirty();
    await this.flushIfNeeded();
  }

  async listPendingSyncOutbox(limit = 32): Promise<SyncOutboxEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw new Error('Sync outbox batch limit must be between 1 and 32.');
    }
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId || !profile.enabled) return [];
    return this.listPendingSyncOutboxForWorkspace(profile.workspaceId, limit);
  }

  async listPendingSyncOutboxForWorkspace(
    workspaceId: string,
    limit = 32,
    after?: { createdAt: number; streamId: string; sequence: number },
  ): Promise<SyncOutboxEntry[]> {
    if (!isUuid(workspaceId)) throw new Error('Sync workspace ID is invalid.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw new Error('Sync outbox batch limit must be between 1 and 32.');
    }
    const db = await this.getDb();
    const rows = db
      .prepare(
        `SELECT operation_json, conference_id, state, created_at, published_at
         FROM sync_outbox
         WHERE state = 'pending' AND substr(stream_id, 1, 37) = ?
           AND (? IS NULL OR created_at > ? OR
             (created_at = ? AND stream_id > ?) OR
             (created_at = ? AND stream_id = ? AND sequence > ?))
         ORDER BY created_at, stream_id, sequence LIMIT ?`,
      )
      .all([
        `${workspaceId}:`,
        after ? 1 : null,
        after?.createdAt ?? null,
        after?.createdAt ?? null,
        after?.streamId ?? null,
        after?.createdAt ?? null,
        after?.streamId ?? null,
        after?.sequence ?? null,
        limit,
      ]) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      operation: JSON.parse(String(row.operation_json)) as SyncOperation,
      conferenceId:
        typeof row.conference_id === 'string' ? row.conference_id : null,
      state: String(row.state) === 'published' ? 'published' : 'pending',
      createdAt: Number(row.created_at),
      publishedAt:
        row.published_at === null || row.published_at === undefined
          ? null
          : Number(row.published_at),
    }));
  }

  async countPendingSyncOutbox() {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId) return 0;
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM sync_outbox
         WHERE state = 'pending' AND substr(stream_id, 1, 37) = ?`,
      )
      .get([`${profile.workspaceId}:`]) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  async markSyncOperationPublished(
    operationId: string,
    publishedAt = this.now(),
  ) {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId) {
      throw new Error('Sync library is not currently connected.');
    }
    const result = db
      .prepare(
        `UPDATE sync_outbox
         SET state = 'published', published_at = COALESCE(published_at, ?)
         WHERE operation_id = ? AND state IN ('pending', 'published')
           AND substr(stream_id, 1, 37) = ?`,
      )
      .run([publishedAt, operationId, `${profile.workspaceId}:`]);
    if (result.changes === 0) {
      throw new Error('Cannot mark an unknown sync operation as published.');
    }
    this.markDirty();
    await this.flushIfNeeded();
  }

  async recordDownloadedSyncOperation(operation: SyncOperation) {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId || profile.workspaceId !== operation.workspaceId) {
      throw new Error('Downloaded operation belongs to another sync library.');
    }
    if (operation.deviceId === profile.deviceId) return false;
    const scopedStreamId = `${profile.workspaceId}:${operation.streamId}`;
    const prior = db
      .prepare('SELECT operation_json FROM sync_inbox WHERE operation_id = ?')
      .get(operation.operationId) as { operation_json?: string } | undefined;
    const operationJson = canonicalJson(operation);
    if (prior) {
      if (prior.operation_json !== operationJson) {
        throw new Error(
          'Conflicting bytes for a previously downloaded operation.',
        );
      }
      return false;
    }
    db.prepare(
      `INSERT INTO sync_inbox (
         operation_id, stream_id, device_id, sequence, operation_json, state,
         discovered_at, applied_at
       ) VALUES (?, ?, ?, ?, ?, 'downloaded', ?, NULL)`,
    ).run([
      operation.operationId,
      scopedStreamId,
      operation.deviceId,
      operation.sequence,
      operationJson,
      this.now(),
    ]);
    this.markDirty();
    await this.flushIfNeeded();
    return true;
  }

  async listDownloadedSyncOperations(streamId?: string) {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId) return [];
    const scopedStreamId = streamId
      ? `${profile.workspaceId}:${streamId}`
      : null;
    const rows = db
      .prepare(
        `SELECT operation_json FROM sync_inbox
         WHERE state = 'downloaded'
           AND substr(stream_id, 1, 37) = ?
           AND (? IS NULL OR stream_id = ?)
         ORDER BY stream_id, device_id, sequence`,
      )
      .all([
        `${profile.workspaceId}:`,
        scopedStreamId,
        scopedStreamId,
      ]) as Array<Record<string, unknown>>;
    return rows.map(
      (row) => JSON.parse(String(row.operation_json)) as SyncOperation,
    );
  }

  async listSyncOperationsForStream(streamId: string) {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId) return [];
    const scopedStreamId = `${profile.workspaceId}:${streamId}`;
    const outbox = db
      .prepare(`SELECT operation_json FROM sync_outbox WHERE stream_id = ?`)
      .all([scopedStreamId]) as Array<Record<string, unknown>>;
    const inbox = db
      .prepare(`SELECT operation_json FROM sync_inbox WHERE stream_id = ?`)
      .all([scopedStreamId]) as Array<Record<string, unknown>>;
    const byId = new Map<string, SyncOperation>();
    for (const row of [...outbox, ...inbox]) {
      const serialized = String(row.operation_json);
      const operation = JSON.parse(serialized) as SyncOperation;
      const previous = byId.get(operation.operationId);
      if (previous && canonicalJson(previous) !== serialized) {
        throw new Error('Conflicting bytes for a sync operation identity.');
      }
      byId.set(operation.operationId, operation);
    }
    return [...byId.values()];
  }

  async applyDownloadedMetadataOperations(streamId: string) {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId || !streamId.startsWith('metadata:')) return false;
    const conferenceId = streamId.slice('metadata:'.length);
    const operations = await this.listSyncOperationsForStream(streamId);
    const pendingInboxRows = db
      .prepare(
        `SELECT operation_id FROM sync_inbox
         WHERE stream_id = ? AND state = 'downloaded'`,
      )
      .all([`${profile.workspaceId}:${streamId}`]) as Array<
      Record<string, unknown>
    >;
    if (!pendingInboxRows.length || !operations.length) return false;
    if (
      operations.some(
        (operation) =>
          operation.kind !== 'noop' &&
          operation.kind !== 'bookmark.set' &&
          operation.kind !== 'conference.metadata' &&
          operation.kind !== 'conference.delete',
      )
    ) {
      return false;
    }

    const streamState = db
      .prepare(
        `SELECT local_frontier_json, remote_frontier_json
         FROM sync_stream_state WHERE stream_id = ?`,
      )
      .get(`${profile.workspaceId}:${streamId}`) as
      | { local_frontier_json?: string; remote_frontier_json?: string }
      | undefined;
    const readiness = causallyReadyMetadataOperations(operations, {
      ...(JSON.parse(streamState?.local_frontier_json ?? '{}') as Record<
        string,
        number
      >),
      ...(JSON.parse(streamState?.remote_frontier_json ?? '{}') as Record<
        string,
        number
      >),
    });
    const readyOperations = readiness.operations;
    if (readyOperations.length === 0) return false;

    const appliedOperationIds = new Set<string>();
    const metadataOperations = operations.filter(
      (operation) =>
        operation.kind === 'conference.metadata' &&
        readyOperations.some(
          (ready) => ready.operationId === operation.operationId,
        ),
    );
    const batches = new Map<
      string,
      { partCount: number; parts: Map<number, SyncOperation> }
    >();
    for (const operation of metadataOperations) {
      const payload = operation.payload;
      const batchId = String(payload.batchId);
      const partIndex = Number(payload.partIndex);
      const partCount = Number(payload.partCount);
      let batch = batches.get(batchId);
      if (!batch) {
        batch = { partCount, parts: new Map() };
        batches.set(batchId, batch);
      }
      if (batch.partCount !== partCount || batch.parts.has(partIndex)) {
        throw new Error(
          'Downloaded metadata batch has duplicate or mismatched parts.',
        );
      }
      batch.parts.set(partIndex, operation);
    }

    const refreshes: Array<{
      operation: SyncOperation;
      upstreamRevision: string | null;
      records: Record<string, unknown>;
    }> = [];
    for (const batch of batches.values()) {
      // partCount and partIndex are validated with a strict upper bound. Do
      // not allocate an attacker-controlled array just to verify completeness.
      if (
        batch.parts.size !== batch.partCount ||
        !batch.parts.has(0) ||
        !batch.parts.has(batch.partCount - 1)
      ) {
        continue;
      }
      const parts = [...batch.parts.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, operation]) => operation);
      const firstPayload = parts[0]!.payload;
      const conference = firstPayload.conference;
      if (!conference || typeof conference !== 'object') {
        throw new Error('Complete metadata batch has no conference record.');
      }
      const talks = parts.flatMap((part) =>
        Array.isArray(part.payload.talks) ? part.payload.talks : [],
      );
      const decks = parts.flatMap((part) =>
        Array.isArray(part.payload.decks) ? part.payload.decks : [],
      );
      refreshes.push({
        operation: parts[parts.length - 1]!,
        upstreamRevision:
          typeof firstPayload.upstreamRevision === 'string'
            ? firstPayload.upstreamRevision
            : null,
        records: { conference, talks, decks },
      });
      for (const part of parts) appliedOperationIds.add(part.operationId);
    }

    const metadataMerge = mergeMetadataRefreshes(refreshes);
    const deletionMerge = mergeConcurrentConferenceDeletion(
      readyOperations.filter(
        (operation) =>
          operation.kind === 'conference.metadata' ||
          operation.kind === 'conference.delete',
      ),
    );
    await this.transaction(async () => {
      if (deletionMerge.deleted) {
        const deletedAt = Math.max(
          ...deletionMerge.operations
            .filter((operation) => operation.kind === 'conference.delete')
            .map((operation) => Number(operation.payload.deletedAt)),
        );
        db.prepare(
          `INSERT INTO sync_hidden_conferences (
             workspace_id, conference_id, hidden_at
           ) VALUES (?, ?, ?)
           ON CONFLICT(workspace_id, conference_id) DO UPDATE SET
             hidden_at = MAX(hidden_at, excluded.hidden_at)`,
        ).run([profile.workspaceId, conferenceId, deletedAt]);
        for (const operation of readyOperations) {
          if (operation.kind === 'conference.delete') {
            appliedOperationIds.add(operation.operationId);
          }
        }
      } else if (metadataMerge.alternatives.length > 0) {
        const conflictId = createHash('sha256')
          .update(canonicalJson([profile.workspaceId, streamId, 'metadata']))
          .digest('hex');
        db.prepare(
          `INSERT INTO sync_conflicts (
             conflict_id, stream_id, entity_id, conflict_json, created_at,
             resolved_at
           ) VALUES (?, ?, ?, ?, ?, NULL)
           ON CONFLICT(conflict_id) DO UPDATE SET
             conflict_json = excluded.conflict_json,
             resolved_at = NULL`,
        ).run([
          conflictId,
          `${profile.workspaceId}:${streamId}`,
          conferenceId,
          canonicalJson({
            kind: 'metadata',
            alternatives: metadataMerge.alternatives,
          }),
          this.now(),
        ]);
      } else if (metadataMerge.refresh) {
        const hidden = db
          .prepare(
            `SELECT 1 FROM sync_hidden_conferences
             WHERE workspace_id = ? AND conference_id = ?`,
          )
          .get([profile.workspaceId, conferenceId]);
        if (!hidden) {
          const records = metadataMerge.refresh.records;
          const remoteConference = records.conference as Conference;
          const localConference = await this.getConference(conferenceId);
          await this.upsertConference({
            ...remoteConference,
            lastOpenedAt: localConference?.lastOpenedAt ?? null,
          });
          for (const remoteTalk of records.talks as Talk[]) {
            const localTalk = await this.getTalk(remoteTalk.id);
            await this.upsertTalk({
              ...remoteTalk,
              bookmarked: localTalk?.bookmarked ?? false,
            });
          }
          for (const remoteDeck of records.decks as Deck[]) {
            const talk = await this.getTalk(remoteDeck.talkId);
            if (!talk || talk.conferenceId !== conferenceId) {
              throw new Error(
                'A remote deck does not match its conference metadata.',
              );
            }
            const localDeck = await this.getDeck(remoteDeck.id);
            await this.upsertDeck({
              ...remoteDeck,
              selected: localDeck?.selected ?? false,
            });
          }
        }
      }
      if (metadataMerge.alternatives.length > 0 || deletionMerge.deleted) {
        for (const batch of batches.values()) {
          if (batch.parts.size === batch.partCount) {
            for (const operation of batch.parts.values()) {
              appliedOperationIds.add(operation.operationId);
            }
          }
        }
      } else if (metadataMerge.refresh) {
        db.prepare(
          `UPDATE sync_conflicts SET resolved_at = ?
           WHERE stream_id = ? AND entity_id = ? AND resolved_at IS NULL`,
        ).run([this.now(), `${profile.workspaceId}:${streamId}`, conferenceId]);
      }

      const bookmarkOperations = readyOperations.filter(
        (operation) => operation.kind === 'bookmark.set',
      );
      const byTalk = new Map<string, SyncOperation[]>();
      for (const operation of bookmarkOperations) {
        const talkId = String(operation.payload.talkId);
        const group = byTalk.get(talkId) ?? [];
        group.push(operation);
        byTalk.set(talkId, group);
      }
      for (const [talkId, changes] of byTalk) {
        const talk = await this.getTalk(talkId);
        if (!talk) continue;
        if (talk.conferenceId !== conferenceId) {
          throw new Error(
            'A remote bookmark does not match its conference stream.',
          );
        }
        const merged = mergeBookmarkState(changes);
        db.prepare(
          'UPDATE talks SET bookmarked = ?, updated_at = ? WHERE id = ?',
        ).run([merged.bookmarked ? 1 : 0, this.now(), talkId]);
        for (const change of changes) {
          appliedOperationIds.add(change.operationId);
        }
      }
      for (const operation of readyOperations) {
        if (operation.kind === 'noop') {
          appliedOperationIds.add(operation.operationId);
        }
      }

      const inboxUpdate = db.prepare(
        `UPDATE sync_inbox SET state = 'applied', applied_at = ?
         WHERE operation_id = ? AND state = 'downloaded'`,
      );
      for (const row of pendingInboxRows) {
        const operationId = String(row.operation_id);
        if (appliedOperationIds.has(operationId)) {
          inboxUpdate.run([this.now(), operationId]);
        }
      }

      const remoteFrontierRow = db
        .prepare(
          'SELECT remote_frontier_json FROM sync_stream_state WHERE stream_id = ?',
        )
        .get(`${profile.workspaceId}:${streamId}`) as
        | { remote_frontier_json?: string }
        | undefined;
      const remoteFrontier = JSON.parse(
        remoteFrontierRow?.remote_frontier_json ?? '{}',
      ) as Record<string, number>;
      const byDevice = new Map<string, Set<number>>();
      for (const operation of readyOperations) {
        if (
          operation.deviceId === profile.deviceId ||
          !appliedOperationIds.has(operation.operationId)
        ) {
          continue;
        }
        const sequences = byDevice.get(operation.deviceId) ?? new Set<number>();
        sequences.add(operation.sequence);
        byDevice.set(operation.deviceId, sequences);
      }
      for (const [remoteDevice, sequences] of byDevice) {
        let next = (remoteFrontier[remoteDevice] ?? 0) + 1;
        while (sequences.has(next)) next += 1;
        remoteFrontier[remoteDevice] = next - 1;
      }
      db.prepare(
        `INSERT INTO sync_stream_state (
           stream_id, next_sequence, local_frontier_json,
           remote_frontier_json, snapshot_id, updated_at
         ) VALUES (?, 1, '{}', ?, NULL, ?)
         ON CONFLICT(stream_id) DO UPDATE SET
           remote_frontier_json = excluded.remote_frontier_json,
           updated_at = excluded.updated_at`,
      ).run([
        `${profile.workspaceId}:${streamId}`,
        canonicalJson(remoteFrontier),
        this.now(),
      ]);
    });
    return appliedOperationIds.size > 0;
  }

  async applyDownloadedAnnotationOperations(streamId: string) {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId || !streamId.startsWith('deck:')) return false;
    const deckId = streamId.slice('deck:'.length);
    const deck = await this.getDeck(deckId);
    if (!deck) return false;
    const operations = await this.listSyncOperationsForStream(streamId);
    const pendingInboxRows = db
      .prepare(
        `SELECT operation_id FROM sync_inbox
         WHERE stream_id = ? AND state IN ('downloaded', 'awaiting-version')`,
      )
      .all([`${profile.workspaceId}:${streamId}`]) as Array<
      Record<string, unknown>
    >;
    const pendingInboxIds = pendingInboxRows.map((row) =>
      String(row.operation_id),
    );
    if (!operations.length) return false;
    if (
      operations.some(
        (operation) =>
          operation.kind !== 'noop' &&
          operation.kind !== 'annotation.put' &&
          operation.kind !== 'annotation.erase' &&
          operation.kind !== 'document-version.associate',
      )
    ) {
      return false;
    }
    const annotationIdForOperation = (operation: SyncOperation) =>
      operation.kind === 'annotation.put'
        ? String((operation.payload.annotation as Record<string, unknown>).id)
        : operation.kind === 'annotation.erase'
          ? String(operation.payload.annotationId)
          : null;
    const operationAnnotationIds = operations
      .map(annotationIdForOperation)
      .filter((id): id is string => id !== null);
    const suppressedIds = new Set<string>();
    if (operationAnnotationIds.length) {
      const uniqueIds = [...new Set(operationAnnotationIds)];
      const placeholders = uniqueIds.map(() => '?').join(',');
      const suppressedRows = db
        .prepare(
          `SELECT annotation_id FROM sync_suppressed_annotations
           WHERE workspace_id = ? AND annotation_id IN (${placeholders})`,
        )
        .all([profile.workspaceId, ...uniqueIds]) as Array<
        Record<string, unknown>
      >;
      for (const row of suppressedRows) {
        suppressedIds.add(String(row.annotation_id));
      }
    }
    const readyAssociations: SyncOperation[] = [];
    const associationTargets = new Map<string, string>();
    const conflictingAssociationIds = new Set<string>();
    for (const operation of operations) {
      if (operation.kind !== 'document-version.associate') continue;
      const ids = operation.payload.annotationIds as string[];
      const toVersion = String(operation.payload.toVersion);
      const puts = operations.filter(
        (candidate) =>
          candidate.kind === 'annotation.put' &&
          candidate.payload.documentVersion === null &&
          ids.includes(
            String(
              (candidate.payload.annotation as Record<string, unknown>).id,
            ),
          ),
      );
      const putIds = new Set(
        puts.map((candidate) =>
          String((candidate.payload.annotation as Record<string, unknown>).id),
        ),
      );
      const placeholders = ids.map(() => '?').join(',');
      const versions = db
        .prepare(
          `SELECT annotation_id, document_version, version_state
           FROM sync_annotation_versions
           WHERE deck_id = ?
             AND annotation_id IN (${placeholders})`,
        )
        .all([deckId, ...ids]) as Array<Record<string, unknown>>;
      const byAnnotation = new Map(
        versions.map((row) => [String(row.annotation_id), row]),
      );
      const complete = ids.every((id) => {
        const existing = byAnnotation.get(id);
        if (
          existing?.version_state === 'known' &&
          existing.document_version === toVersion
        ) {
          return true;
        }
        return (
          existing?.version_state === 'unknown' || (!existing && putIds.has(id))
        );
      });
      if (!complete) continue;
      readyAssociations.push(operation);
      for (const id of ids) {
        if (conflictingAssociationIds.has(id)) continue;
        const previous = associationTargets.get(id);
        if (previous && previous !== toVersion) {
          conflictingAssociationIds.add(id);
          associationTargets.delete(id);
        } else {
          associationTargets.set(id, toVersion);
        }
      }
    }
    for (let index = readyAssociations.length - 1; index >= 0; index -= 1) {
      const ids = readyAssociations[index]!.payload.annotationIds as string[];
      if (ids.some((id) => conflictingAssociationIds.has(id))) {
        readyAssociations.splice(index, 1);
      }
    }
    const visibleOperations = operations
      .filter((operation) => {
        const annotationId = annotationIdForOperation(operation);
        return annotationId === null || !suppressedIds.has(annotationId);
      })
      .map((operation) => {
        const annotationId = annotationIdForOperation(operation);
        const associatedVersion = annotationId
          ? associationTargets.get(annotationId)
          : undefined;
        if (
          !associatedVersion ||
          (operation.kind !== 'annotation.put' &&
            operation.kind !== 'annotation.erase') ||
          operation.payload.documentVersion !== null
        ) {
          return operation;
        }
        return {
          ...operation,
          payload: { ...operation.payload, documentVersion: associatedVersion },
        };
      });
    const observedSequences = new Map<string, Set<number>>();
    for (const operation of operations) {
      const sequences =
        observedSequences.get(operation.deviceId) ?? new Set<number>();
      sequences.add(operation.sequence);
      observedSequences.set(operation.deviceId, sequences);
    }
    const contiguousObserved = new Map<string, number>();
    for (const [deviceId, sequences] of observedSequences) {
      let next = 1;
      while (sequences.has(next)) next += 1;
      contiguousObserved.set(deviceId, next - 1);
    }
    for (const operation of operations) {
      if (
        Object.entries(operation.context).some(
          ([deviceId, sequence]) =>
            sequence > (contiguousObserved.get(deviceId) ?? 0),
        )
      ) {
        return false;
      }
      for (const requirement of operation.requires) {
        const prerequisite = db
          .prepare(
            `SELECT local_frontier_json, remote_frontier_json
             FROM sync_stream_state WHERE stream_id = ?`,
          )
          .get(`${profile.workspaceId}:${requirement.streamId}`) as
          | {
              local_frontier_json?: string;
              remote_frontier_json?: string;
            }
          | undefined;
        const available = {
          ...(JSON.parse(prerequisite?.local_frontier_json ?? '{}') as Record<
            string,
            number
          >),
          ...(JSON.parse(prerequisite?.remote_frontier_json ?? '{}') as Record<
            string,
            number
          >),
        };
        for (const [deviceId, sequence] of Object.entries(
          requirement.frontier,
        )) {
          if (sequence > (available[deviceId] ?? 0)) return false;
        }
      }
    }
    const dbDeckVersion = db
      .prepare(
        `SELECT document_version FROM sync_document_versions WHERE deck_id = ?`,
      )
      .get(deckId) as { document_version?: string | null } | undefined;
    const activeDocumentVersion = dbDeckVersion?.document_version ?? null;
    const matchingOperations =
      activeDocumentVersion === null
        ? []
        : visibleOperations.filter((operation) => {
            if (
              operation.kind !== 'annotation.put' &&
              operation.kind !== 'annotation.erase'
            ) {
              return false;
            }
            const version =
              operation.kind === 'annotation.put'
                ? operation.payload.documentVersion
                : operation.payload.documentVersion;
            return version === activeDocumentVersion;
          });
    const merged = matchingOperations.length
      ? mergeAnnotationOperations(matchingOperations)
      : {
          annotations: [],
          tombstones: [],
          conflicts: [],
          duplicateOperationIds: [],
        };
    const requiredSlides = merged.annotations.map((item) =>
      String(item.annotation.slideId),
    );
    if (requiredSlides.length) {
      const placeholders = requiredSlides.map(() => '?').join(',');
      const slides = db
        .prepare(
          `SELECT id FROM slides WHERE deck_id = ? AND id IN (${placeholders})`,
        )
        .all([deckId, ...requiredSlides]) as Array<Record<string, unknown>>;
      if (slides.length !== new Set(requiredSlides).size) return false;
    }
    const appliedAssociationIds = new Set<string>();
    await this.transaction(async () => {
      const associate = db.prepare(
        `UPDATE sync_annotation_versions
         SET document_version = ?, version_state = 'known', updated_at = ?
         WHERE annotation_id = ? AND deck_id = ? AND version_state = 'unknown'`,
      );
      for (const operation of readyAssociations) {
        const ids = operation.payload.annotationIds as string[];
        const version = String(operation.payload.toVersion);
        for (const id of ids) {
          associate.run([version, this.now(), id, deckId]);
        }
        appliedAssociationIds.add(operation.operationId);
      }
      const conflictIds = new Set(
        merged.conflicts.map((conflict) => conflict.annotationId),
      );
      const operationAnnotationIds = new Set(
        matchingOperations.map((operation) =>
          operation.kind === 'annotation.put'
            ? String(
                (operation.payload.annotation as Record<string, unknown>).id,
              )
            : String(operation.payload.annotationId),
        ),
      );
      for (const annotationId of operationAnnotationIds) {
        if (conflictIds.has(annotationId)) continue;
        db.prepare('DELETE FROM annotations WHERE id = ? AND deck_id = ?').run([
          annotationId,
          deckId,
        ]);
      }
      for (const item of merged.annotations) {
        const annotation = item.annotation as unknown as Annotation;
        if (
          annotation.deckId !== deckId ||
          annotation.conferenceId !== deck.conferenceId ||
          annotation.talkId !== deck.talkId
        ) {
          throw new Error(
            'A remote annotation does not match its local deck identity.',
          );
        }
        db.prepare(
          `INSERT INTO sync_annotation_versions (
             annotation_id, deck_id, document_version, version_state,
             association_operation_id, updated_at
           ) VALUES (?, ?, ?, ?, NULL, ?)
           ON CONFLICT(annotation_id) DO UPDATE SET
             deck_id = excluded.deck_id,
             document_version = excluded.document_version,
             version_state = excluded.version_state,
             updated_at = excluded.updated_at`,
        ).run([
          annotation.id,
          deckId,
          item.documentVersion,
          item.documentVersion === null ? 'unknown' : 'known',
          this.now(),
        ]);
        await this.upsertAnnotation(annotation);
      }
      for (const conflict of merged.conflicts) {
        const conflictId = createHash('sha256')
          .update(
            canonicalJson([
              profile.workspaceId,
              streamId,
              conflict.documentVersion,
              conflict.annotationId,
            ]),
          )
          .digest('hex');
        db.prepare(
          `INSERT INTO sync_conflicts (
             conflict_id, stream_id, entity_id, conflict_json, created_at,
             resolved_at
           ) VALUES (?, ?, ?, ?, ?, NULL)
           ON CONFLICT(conflict_id) DO UPDATE SET
             conflict_json = excluded.conflict_json,
             resolved_at = NULL`,
        ).run([
          conflictId,
          `${profile.workspaceId}:${streamId}`,
          conflict.annotationId,
          canonicalJson(conflict),
          this.now(),
        ]);
      }
      if (pendingInboxIds.length) {
        const matchedIds = new Set(
          matchingOperations.map((operation) => operation.operationId),
        );
        for (const operationId of appliedAssociationIds) {
          matchedIds.add(operationId);
        }
        for (const operation of operations) {
          const annotationId = annotationIdForOperation(operation);
          if (
            operation.kind === 'noop' ||
            (annotationId && suppressedIds.has(annotationId))
          ) {
            matchedIds.add(operation.operationId);
          }
        }
        const appliedIds = pendingInboxIds.filter((id) => matchedIds.has(id));
        const awaitingVersionIds = pendingInboxIds.filter(
          (id) => !matchedIds.has(id),
        );
        const updateState = db.prepare(
          `UPDATE sync_inbox SET state = ?, applied_at = ?
           WHERE operation_id = ? AND state IN ('downloaded', 'awaiting-version')`,
        );
        for (const operationId of appliedIds) {
          updateState.run(['applied', this.now(), operationId]);
        }
        for (const operationId of awaitingVersionIds) {
          updateState.run(['awaiting-version', null, operationId]);
        }
      }
      const stateKey = `${profile.workspaceId}:${streamId}`;
      const stateRow = db
        .prepare(
          'SELECT remote_frontier_json FROM sync_stream_state WHERE stream_id = ?',
        )
        .get(stateKey) as { remote_frontier_json?: string } | undefined;
      const remoteFrontier = JSON.parse(
        stateRow?.remote_frontier_json ?? '{}',
      ) as Record<string, number>;
      const byDevice = new Map<string, Set<number>>();
      const appliedRemoteRows = db
        .prepare(
          `SELECT device_id, sequence FROM sync_inbox
           WHERE stream_id = ? AND device_id <> ? AND state = 'applied'`,
        )
        .all([stateKey, profile.deviceId]) as Array<Record<string, unknown>>;
      for (const row of appliedRemoteRows) {
        const deviceId = String(row.device_id);
        const sequences = byDevice.get(deviceId) ?? new Set<number>();
        sequences.add(Number(row.sequence));
        byDevice.set(deviceId, sequences);
      }
      for (const [remoteDevice, sequences] of byDevice) {
        let next = (remoteFrontier[remoteDevice] ?? 0) + 1;
        while (sequences.has(next)) next += 1;
        remoteFrontier[remoteDevice] = next - 1;
      }
      db.prepare(
        `INSERT INTO sync_stream_state (
           stream_id, next_sequence, local_frontier_json,
           remote_frontier_json, snapshot_id, updated_at
         ) VALUES (?, 1, '{}', ?, NULL, ?)
         ON CONFLICT(stream_id) DO UPDATE SET
           remote_frontier_json = excluded.remote_frontier_json,
           updated_at = excluded.updated_at`,
      ).run([stateKey, canonicalJson(remoteFrontier), this.now()]);
    });
    return true;
  }

  async close() {
    await this.flushIfNeeded();
    this.db?.close();
    this.db = null;
  }

  async transaction<T>(
    work: (store: PersistenceStore) => T | Promise<T>,
  ): Promise<T> {
    const db = await this.getDb();
    this.transactionDepth += 1;
    db.exec('BEGIN TRANSACTION');
    try {
      const result = await work(this);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures.
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0) {
        await this.flushIfNeeded();
      }
    }
  }

  async upsertConference(conference: Conference): Promise<Conference> {
    const db = await this.getDb();
    db.prepare(
      `
        INSERT INTO conferences (
          id, source_url, title, dates, host, source_kind, time_zone, last_opened_at, created_at, updated_at
        ) VALUES (
          @id, @sourceUrl, @title, @dates, @host, @sourceKind, @timeZone, @lastOpenedAt, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          source_url = excluded.source_url,
          title = excluded.title,
          dates = excluded.dates,
          host = excluded.host,
          source_kind = excluded.source_kind,
          time_zone = excluded.time_zone,
          last_opened_at = excluded.last_opened_at,
          updated_at = excluded.updated_at
      `,
    ).run({
      ...conference,
      sourceUrl: conference.sourceUrl,
      sourceKind: conference.sourceKind ?? 'indico',
      timeZone: conference.timeZone ?? null,
      lastOpenedAt: conference.lastOpenedAt,
    });

    this.markDirty();
    await this.flushIfNeeded();
    return (await this.getConference(conference.id)) ?? conference;
  }

  async getConference(id: string): Promise<Conference | null> {
    const db = await this.getDb();
    const row = getStatementValue(
      db.prepare('SELECT * FROM conferences WHERE id = ?'),
      id,
    );
    return row ? rowToConference(row as Record<string, unknown>) : null;
  }

  async listConferences(): Promise<Conference[]> {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    const rows = db
      .prepare(
        `SELECT * FROM conferences
         WHERE (? IS NULL OR NOT EXISTS (
           SELECT 1 FROM sync_hidden_conferences AS hidden
           WHERE hidden.workspace_id = ? AND hidden.conference_id = conferences.id
         ))
         ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC`,
      )
      .all([profile.workspaceId, profile.workspaceId]) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => rowToConference(row));
  }

  async touchConference(id: string, lastOpenedAt = this.now()) {
    const db = await this.getDb();
    db.prepare(
      'UPDATE conferences SET last_opened_at = ?, updated_at = ? WHERE id = ?',
    ).run([lastOpenedAt, lastOpenedAt, id]);
    this.markDirty();
    await this.flushIfNeeded();
  }

  async deleteConference(id: string) {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    const conference = await this.getConference(id);
    if (
      profile.workspaceId &&
      conference &&
      isShareableSourceUrl(conference.sourceUrl)
    ) {
      const deletedAt = this.now();
      await this.transaction(async () => {
        db.prepare(
          `INSERT INTO sync_hidden_conferences (workspace_id, conference_id, hidden_at)
           VALUES (?, ?, ?)
           ON CONFLICT(workspace_id, conference_id) DO UPDATE SET
             hidden_at = excluded.hidden_at`,
        ).run([profile.workspaceId, id, deletedAt]);
        await this.recordLocalSyncOperation(
          `metadata:${id}`,
          id,
          'conference.delete',
          { deletedAt, reason: 'user' },
        );
      });
      await this.flushIfNeeded();
      return;
    }
    db.prepare('DELETE FROM view_state WHERE conference_id = ?').run(id);
    db.prepare('DELETE FROM annotations WHERE conference_id = ?').run(id);
    db.prepare('DELETE FROM slides WHERE conference_id = ?').run(id);
    db.prepare('DELETE FROM decks WHERE conference_id = ?').run(id);
    db.prepare('DELETE FROM talks WHERE conference_id = ?').run(id);
    db.prepare('DELETE FROM conferences WHERE id = ?').run(id);
    this.markDirty();
    await this.flushIfNeeded();
  }

  async upsertTalk(talk: Talk): Promise<Talk> {
    const db = await this.getDb();
    db.prepare(
      `
        INSERT INTO talks (
          id, conference_id, contribution_id, contribution_url, title, speaker,
          session_title, starts_at, ends_at, room, bookmarked, upstream_status,
          entry_kind, linked_agenda_url,
          created_at, updated_at
        ) VALUES (
          @id, @conferenceId, @contributionId, @contributionUrl, @title,
          @speaker, @sessionTitle, @startsAt, @endsAt, @room, @bookmarked,
          @upstreamStatus, @entryKind, @linkedAgendaUrl, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          conference_id = excluded.conference_id,
          contribution_id = excluded.contribution_id,
          contribution_url = excluded.contribution_url,
          title = excluded.title,
          speaker = excluded.speaker,
          session_title = excluded.session_title,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          room = excluded.room,
          bookmarked = excluded.bookmarked,
          upstream_status = excluded.upstream_status,
          entry_kind = excluded.entry_kind,
          linked_agenda_url = excluded.linked_agenda_url,
          updated_at = excluded.updated_at
      `,
    ).run({
      ...talk,
      bookmarked: talk.bookmarked ? 1 : 0,
      conferenceId: talk.conferenceId,
      contributionId: talk.contributionId,
      contributionUrl: talk.contributionUrl,
      sessionTitle: talk.sessionTitle,
      startsAt: talk.startsAt,
      endsAt: talk.endsAt,
      upstreamStatus: talk.upstreamStatus ?? 'present',
      entryKind: talk.entryKind ?? 'talk',
      linkedAgendaUrl: talk.linkedAgendaUrl ?? '',
    });

    this.markDirty();
    await this.flushIfNeeded();
    return (await this.getTalk(talk.id)) ?? talk;
  }

  async getTalk(id: string): Promise<Talk | null> {
    const db = await this.getDb();
    const row = getStatementValue(
      db.prepare('SELECT * FROM talks WHERE id = ?'),
      id,
    );
    return row ? rowToTalk(row as Record<string, unknown>) : null;
  }

  async listTalksByConference(conferenceId: string): Promise<Talk[]> {
    const db = await this.getDb();
    const rows = db
      .prepare('SELECT * FROM talks WHERE conference_id = ? ORDER BY title')
      .all(conferenceId) as Record<string, unknown>[];
    return rows.map((row) => rowToTalk(row));
  }

  async deleteTalk(id: string) {
    const db = await this.getDb();
    db.prepare('DELETE FROM view_state WHERE talk_id = ?').run(id);
    db.prepare('DELETE FROM annotations WHERE talk_id = ?').run(id);
    db.prepare('DELETE FROM slides WHERE talk_id = ?').run(id);
    db.prepare('DELETE FROM decks WHERE talk_id = ?').run(id);
    db.prepare('DELETE FROM talks WHERE id = ?').run(id);
    this.markDirty();
    await this.flushIfNeeded();
  }

  async setTalkBookmarked(id: string, bookmarked: boolean) {
    const db = await this.getDb();
    await this.transaction(async () => {
      const talk = await this.getTalk(id);
      if (!talk || talk.bookmarked === bookmarked) return;
      db.prepare(
        'UPDATE talks SET bookmarked = ?, updated_at = ? WHERE id = ?',
      ).run([bookmarked ? 1 : 0, this.now(), id]);
      const conference = await this.getConference(talk.conferenceId);
      if (conference && isShareableSourceUrl(conference.sourceUrl)) {
        await this.recordLocalSyncOperation(
          `metadata:${conference.id}`,
          conference.id,
          'bookmark.set',
          { talkId: talk.id, bookmarked },
        );
      }
      this.markDirty();
    });
    await this.flushIfNeeded();
  }

  async upsertDeck(deck: Deck): Promise<Deck> {
    const db = await this.getDb();
    db.prepare(
      `
        INSERT INTO decks (
          id, conference_id, talk_id, source_url, display_name, mime_type,
          selected, upstream_status, kind, created_at, updated_at
        ) VALUES (
          @id, @conferenceId, @talkId, @sourceUrl, @displayName, @mimeType,
          @selected, @upstreamStatus, @kind, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          conference_id = excluded.conference_id,
          talk_id = excluded.talk_id,
          source_url = excluded.source_url,
          display_name = excluded.display_name,
          mime_type = excluded.mime_type,
          selected = excluded.selected,
          upstream_status = excluded.upstream_status,
          kind = excluded.kind,
          updated_at = excluded.updated_at
      `,
    ).run({
      ...deck,
      selected: deck.selected ? 1 : 0,
      conferenceId: deck.conferenceId,
      talkId: deck.talkId,
      sourceUrl: deck.sourceUrl,
      displayName: deck.displayName,
      mimeType: deck.mimeType,
      upstreamStatus: deck.upstreamStatus ?? 'present',
      kind: deck.kind ?? 'pdf',
    });

    this.markDirty();
    await this.flushIfNeeded();
    return (await this.getDeck(deck.id)) ?? deck;
  }

  async getDeck(id: string): Promise<Deck | null> {
    const db = await this.getDb();
    const row = getStatementValue(
      db.prepare('SELECT * FROM decks WHERE id = ?'),
      id,
    );
    return row ? rowToDeck(row as Record<string, unknown>) : null;
  }

  async listDecksByTalk(talkId: string): Promise<Deck[]> {
    const db = await this.getDb();
    const rows = db
      .prepare('SELECT * FROM decks WHERE talk_id = ? ORDER BY created_at')
      .all(talkId) as Record<string, unknown>[];
    return rows.map((row) => rowToDeck(row));
  }

  async listDecksByConference(conferenceId: string): Promise<Deck[]> {
    const db = await this.getDb();
    const rows = db
      .prepare(
        `SELECT decks.*
         FROM talks
         JOIN decks ON decks.talk_id = talks.id
         WHERE talks.conference_id = ?
         ORDER BY decks.talk_id, decks.created_at`,
      )
      .all(conferenceId) as Record<string, unknown>[];
    return rows.map((row) => rowToDeck(row));
  }

  async ensureNotebookDeck(talkId: string): Promise<Deck> {
    const talk = await this.getTalk(talkId);
    if (!talk) {
      throw new Error('Cannot create notes for an unknown talk.');
    }

    const deckId = createNotebookDeckId(talkId);
    const existing = await this.getDeck(deckId);
    if (existing) {
      return existing;
    }

    const now = this.now();
    return this.upsertDeck({
      id: deckId,
      conferenceId: talk.conferenceId,
      talkId,
      sourceUrl: `indicoink://notebook/${talkId}`,
      displayName: 'Talk notes',
      mimeType: 'application/x-indicoink-notebook',
      selected: false,
      kind: 'notebook',
      createdAt: now,
      updatedAt: now,
    });
  }

  async deleteDeck(id: string) {
    const db = await this.getDb();
    db.prepare('DELETE FROM view_state WHERE deck_id = ?').run(id);
    db.prepare('DELETE FROM annotations WHERE deck_id = ?').run(id);
    db.prepare('DELETE FROM slides WHERE deck_id = ?').run(id);
    db.prepare('DELETE FROM workspace_history WHERE deck_id = ?').run(id);
    db.prepare('DELETE FROM workspace_revision WHERE deck_id = ?').run(id);
    db.prepare('DELETE FROM decks WHERE id = ?').run(id);
    this.markDirty();
    await this.flushIfNeeded();
  }

  async setSelectedDeck(id: string, selected: boolean) {
    const db = await this.getDb();
    db.prepare(
      'UPDATE decks SET selected = ?, updated_at = ? WHERE id = ?',
    ).run([selected ? 1 : 0, this.now(), id]);
    this.markDirty();
    await this.flushIfNeeded();
  }

  async setSelectedDeckForTalk(talkId: string, deckId: string) {
    const db = await this.getDb();
    db.prepare(
      'UPDATE decks SET selected = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ? WHERE talk_id = ?',
    ).run([deckId, this.now(), talkId]);
    this.markDirty();
    await this.flushIfNeeded();
  }

  async upsertSlide(slide: Slide): Promise<Slide> {
    const db = await this.getDb();
    db.prepare(
      `
        INSERT INTO slides (
          id, conference_id, talk_id, deck_id, slide_number, annotated,
          created_at, updated_at
        ) VALUES (
          @id, @conferenceId, @talkId, @deckId, @slideNumber, @annotated,
          @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          conference_id = excluded.conference_id,
          talk_id = excluded.talk_id,
          deck_id = excluded.deck_id,
          slide_number = excluded.slide_number,
          annotated = excluded.annotated,
          updated_at = excluded.updated_at
      `,
    ).run({
      ...slide,
      annotated: slide.annotated ? 1 : 0,
      conferenceId: slide.conferenceId,
      talkId: slide.talkId,
      deckId: slide.deckId,
      slideNumber: slide.slideNumber,
    });

    this.markDirty();
    await this.flushIfNeeded();
    return (await this.getSlide(slide.id)) ?? slide;
  }

  async getSlide(id: string): Promise<Slide | null> {
    const db = await this.getDb();
    const row = getStatementValue(
      db.prepare('SELECT * FROM slides WHERE id = ?'),
      id,
    );
    return row ? rowToSlide(row as Record<string, unknown>) : null;
  }

  async listSlidesByDeck(deckId: string): Promise<Slide[]> {
    const db = await this.getDb();
    const rows = db
      .prepare('SELECT * FROM slides WHERE deck_id = ? ORDER BY slide_number')
      .all(deckId) as Record<string, unknown>[];
    return rows.map((row) => rowToSlide(row));
  }

  async listSlidesByConference(conferenceId: string): Promise<Slide[]> {
    const db = await this.getDb();
    const rows = db
      .prepare(
        `SELECT slides.*
         FROM talks
         JOIN decks ON decks.talk_id = talks.id
         JOIN slides ON slides.deck_id = decks.id
         WHERE talks.conference_id = ?
         ORDER BY slides.deck_id, slides.slide_number`,
      )
      .all(conferenceId) as Record<string, unknown>[];
    return rows.map((row) => rowToSlide(row));
  }

  async setSlideAnnotated(id: string, annotated: boolean) {
    const db = await this.getDb();
    db.prepare(
      'UPDATE slides SET annotated = ?, updated_at = ? WHERE id = ?',
    ).run([annotated ? 1 : 0, this.now(), id]);
    this.markDirty();
    await this.flushIfNeeded();
  }

  async upsertAnnotation(annotation: Annotation) {
    const db = await this.getDb();
    const payloadJson =
      'points' in annotation
        ? serializeStrokePayload(
            annotation.points,
            annotation.baseWidth,
            annotation.color,
          )
        : JSON.stringify({
            x: annotation.x,
            y: annotation.y,
            width: annotation.width,
            text: annotation.text,
          });

    db.prepare(
      `
        INSERT INTO annotations (
          id, conference_id, talk_id, deck_id, slide_id, kind, payload_json,
          created_at, updated_at
        ) VALUES (
          @id, @conferenceId, @talkId, @deckId, @slideId, @kind, @payloadJson,
          @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          conference_id = excluded.conference_id,
          talk_id = excluded.talk_id,
          deck_id = excluded.deck_id,
          slide_id = excluded.slide_id,
          kind = excluded.kind,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `,
    ).run({
      id: annotation.id,
      conferenceId: annotation.conferenceId,
      talkId: annotation.talkId,
      deckId: annotation.deckId,
      slideId: annotation.slideId,
      kind: 'points' in annotation ? 'stroke' : 'text',
      payloadJson,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    });

    await this.refreshSlideAnnotationState(annotation.slideId);
    this.markDirty();
    await this.flushIfNeeded();
  }

  async getAnnotation(id: string): Promise<Annotation | null> {
    const db = await this.getDb();
    const row = getStatementValue(
      db.prepare('SELECT * FROM annotations WHERE id = ?'),
      id,
    );
    return row ? rowToAnnotation(row as Record<string, unknown>) : null;
  }

  async listAnnotationsBySlide(slideId: string): Promise<Annotation[]> {
    const db = await this.getDb();
    const rows = db
      .prepare(
        'SELECT * FROM annotations WHERE slide_id = ? ORDER BY created_at, id',
      )
      .all(slideId) as Record<string, unknown>[];
    return rows.map((row) => rowToAnnotation(row));
  }

  async deleteAnnotation(id: string) {
    const db = await this.getDb();
    const annotation = await this.getAnnotation(id);
    db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
    if (annotation) {
      await this.refreshSlideAnnotationState(annotation.slideId);
    }
    this.markDirty();
    await this.flushIfNeeded();
  }

  async countAnnotatedSlidesByTalk(talkId: string) {
    const db = await this.getDb();
    const row = db
      .prepare(
        'SELECT COUNT(*) AS count FROM slides WHERE talk_id = ? AND annotated = 1',
      )
      .get(talkId) as { count?: number } | undefined;

    return Number(row?.count ?? 0);
  }

  async upsertViewState(viewState: ViewStateRecord): Promise<StoredViewState> {
    const db = await this.getDb();
    db.prepare(
      `
        INSERT INTO view_state (
          id, conference_id, talk_id, deck_id, slide_id, current_slide_number,
          zoom, scroll_left, scroll_top, undo_stack_json, redo_stack_json,
          created_at, updated_at
        ) VALUES (
          @id, @conferenceId, @talkId, @deckId, @slideId, @currentSlideNumber,
          @zoom, @scrollLeft, @scrollTop, @undoStackJson, @redoStackJson,
          @createdAt, @updatedAt
        )
        ON CONFLICT(conference_id, talk_id, deck_id) DO UPDATE SET
          slide_id = excluded.slide_id,
          current_slide_number = excluded.current_slide_number,
          zoom = excluded.zoom,
          scroll_left = excluded.scroll_left,
          scroll_top = excluded.scroll_top,
          undo_stack_json = excluded.undo_stack_json,
          redo_stack_json = excluded.redo_stack_json,
          updated_at = excluded.updated_at
      `,
    ).run({
      ...viewState,
      conferenceId: viewState.conferenceId,
      talkId: viewState.talkId,
      deckId: viewState.deckId,
      slideId: viewState.slideId,
      currentSlideNumber: viewState.currentSlideNumber,
      zoom: viewState.zoom,
      scrollLeft: viewState.scrollLeft,
      scrollTop: viewState.scrollTop,
      undoStackJson: serializeWorkspaceHistory(viewState.undoStack ?? []),
      redoStackJson: serializeWorkspaceHistory(viewState.redoStack ?? []),
    });

    this.markDirty();
    await this.flushIfNeeded();
    return (
      (await this.getViewState(viewState.deckId)) ?? {
        ...viewState,
        undoStack: viewState.undoStack ?? [],
        redoStack: viewState.redoStack ?? [],
      }
    );
  }

  async getViewState(deckId: string): Promise<StoredViewState | null> {
    const db = await this.getDb();
    const row = getStatementValue(
      db.prepare('SELECT * FROM view_state WHERE deck_id = ?'),
      deckId,
    );
    return row ? rowToViewState(row as Record<string, unknown>) : null;
  }

  async getWorkspaceHistory(
    deckId: string,
  ): Promise<PdfWorkspaceHistory | null> {
    const db = await this.getDb();
    const rows = db
      .prepare(
        `SELECT stack, payload_json
         FROM workspace_history
         WHERE deck_id = ?
         ORDER BY stack, position`,
      )
      .all(deckId) as Array<{
      stack: 'undo' | 'redo';
      payload_json: string;
    }>;
    if (!rows.length) {
      return null;
    }

    const history: PdfWorkspaceHistory = {
      version: 2,
      undo: [],
      redo: [],
    };
    for (const row of rows) {
      const entry = parseWorkspaceHistoryEntry(String(row.payload_json));
      if (entry && (row.stack === 'undo' || row.stack === 'redo')) {
        history[row.stack].push(entry);
      }
    }
    return history;
  }

  async getWorkspaceRevision(deckId: string) {
    const db = await this.getDb();
    const row = db
      .prepare('SELECT revision FROM workspace_revision WHERE deck_id = ?')
      .get(deckId) as { revision?: number } | undefined;
    return Number(row?.revision ?? 0);
  }

  async replaceWorkspaceHistory(deckId: string, history: PdfWorkspaceHistory) {
    const db = await this.getDb();
    const existingRows = db
      .prepare(
        `SELECT id, stack, position, payload_json
         FROM workspace_history
         WHERE deck_id = ?
         ORDER BY stack, position`,
      )
      .all(deckId) as Array<{
      id: string;
      stack: 'undo' | 'redo';
      position: number;
      payload_json: string;
    }>;
    const desiredIds = new Set(
      (['undo', 'redo'] as const).flatMap((stack) =>
        history[stack].map((entry) => `${deckId}:${stack}:${entry.id}`),
      ),
    );
    const deleteRow = db.prepare(
      'DELETE FROM workspace_history WHERE id = ? AND deck_id = ?',
    );
    for (const row of existingRows) {
      if (!desiredIds.has(row.id)) {
        deleteRow.run([row.id, deckId]);
      }
    }

    const upsert = db.prepare(
      `INSERT INTO workspace_history (
         id, deck_id, stack, position, payload_json, created_at
       ) VALUES (
         @id, @deckId, @stack, @position, @payloadJson, @createdAt
       )
       ON CONFLICT(id) DO UPDATE SET
         stack = excluded.stack,
         position = excluded.position,
         payload_json = excluded.payload_json`,
    );
    for (const stack of ['undo', 'redo'] as const) {
      const existingForStack = existingRows.filter(
        (row) => row.stack === stack && desiredIds.has(row.id),
      );
      const existingById = new Map(
        existingForStack.map((row) => [row.id, row]),
      );
      const desired = history[stack].map((entry) => ({
        entry,
        id: `${deckId}:${stack}:${entry.id}`,
      }));
      const firstExistingIndex = desired.findIndex(({ id }) =>
        existingById.has(id),
      );
      const canPreservePositions =
        firstExistingIndex < 0 ||
        desired
          .slice(firstExistingIndex)
          .every(({ id }) => existingById.has(id));
      const firstPosition = existingForStack[0]?.position ?? 0;

      desired.forEach(({ entry, id }, index) => {
        const existing = existingById.get(id);
        const position =
          canPreservePositions && existing
            ? existing.position
            : canPreservePositions
              ? firstPosition - firstExistingIndex + index
              : index;
        const payloadJson = JSON.stringify(entry);
        if (
          existing &&
          existing.position === position &&
          existing.payload_json === payloadJson
        ) {
          return;
        }
        upsert.run({
          id,
          deckId,
          stack,
          position,
          payloadJson,
          createdAt: this.now(),
        });
      });
    }
    this.markDirty();
    await this.flushIfNeeded();
  }

  async deleteViewState(deckId: string) {
    const db = await this.getDb();
    db.prepare('DELETE FROM view_state WHERE deck_id = ?').run(deckId);
    this.markDirty();
    await this.flushIfNeeded();
  }

  private async refreshSlideAnnotationState(slideId: string) {
    const db = await this.getDb();
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM annotations WHERE slide_id = ?')
      .get(slideId) as { count?: number } | undefined;
    db.prepare(
      'UPDATE slides SET annotated = ?, updated_at = ? WHERE id = ?',
    ).run([Number(row?.count ?? 0) > 0 ? 1 : 0, this.now(), slideId]);
  }

  async loadLocalPdfWorkspace(
    sourceUrl: string,
  ): Promise<PdfWorkspaceSnapshot | null> {
    const conferenceId = createConferenceId(sourceUrl);
    const talkId = createTalkId(conferenceId, sourceUrl);
    const deckId = createDeckId(talkId, sourceUrl);
    const conference = await this.getConference(conferenceId);
    const deck = await this.getDeck(deckId);

    if (!conference || !deck) {
      return null;
    }

    const slides = await this.listSlidesByDeck(deckId);
    const syncProfile = await this.getSyncProfile();
    const visibleAnnotationRows = syncProfile.workspaceId
      ? ((await this.getDb())
          .prepare(
            `SELECT annotation_version.annotation_id
         FROM sync_annotation_versions AS annotation_version
         INNER JOIN sync_document_versions AS document_version
           ON document_version.deck_id = annotation_version.deck_id
         WHERE annotation_version.deck_id = ?
           AND annotation_version.version_state = 'known'
           AND document_version.version_state = 'known'
           AND annotation_version.document_version = document_version.document_version`,
          )
          .all([deckId]) as Array<Record<string, unknown>>)
      : null;
    const visibleAnnotationIds = visibleAnnotationRows
      ? new Set(visibleAnnotationRows.map((row) => String(row.annotation_id)))
      : null;
    const annotationsBySlide = new Map<string, Annotation[]>();
    for (const slide of slides) {
      annotationsBySlide.set(
        slide.id,
        (await this.listAnnotationsBySlide(slide.id)).filter(
          (annotation) =>
            !visibleAnnotationIds || visibleAnnotationIds.has(annotation.id),
        ),
      );
    }
    const viewState = await this.getViewState(deckId);
    const history = await this.getWorkspaceHistory(deckId);
    const revision = await this.getWorkspaceRevision(deckId);

    return {
      sourceUrl,
      conferenceId: conference.id,
      talkId: talkId,
      deckId,
      pageCount: slides.length,
      revision,
      ...(history ? { history } : {}),
      undoStack: viewState?.undoStack ?? [],
      redoStack: viewState?.redoStack ?? [],
      strokesByPage: slides.map((slide) =>
        (annotationsBySlide.get(slide.id) ?? [])
          .filter(
            (annotation): annotation is PenStroke =>
              'points' in annotation && annotation.points.length > 0,
          )
          .map((annotation) => ({
            id: annotation.id,
            pageNumber: slide.slideNumber,
            ...(annotation.baseWidth === undefined
              ? {}
              : { baseWidth: annotation.baseWidth }),
            ...(annotation.color === undefined
              ? {}
              : { color: annotation.color }),
            points: annotation.points,
          })),
      ),
      textNotesByPage: slides.map((slide) =>
        (annotationsBySlide.get(slide.id) ?? [])
          .filter(
            (annotation): annotation is TextNote =>
              !('points' in annotation) && typeof annotation.text === 'string',
          )
          .map((annotation) => ({
            id: annotation.id,
            conferenceId: annotation.conferenceId,
            talkId: annotation.talkId,
            deckId: annotation.deckId,
            slideId: slide.id,
            x: annotation.x,
            y: annotation.y,
            width: annotation.width,
            text: annotation.text,
            createdAt: annotation.createdAt,
            updatedAt: annotation.updatedAt,
          })),
      ),
      currentSlideNumber: viewState?.currentSlideNumber ?? 1,
      scrollLeft: viewState?.scrollLeft ?? 0,
      scrollTop: viewState?.scrollTop ?? 0,
      zoom: viewState?.zoom ?? 1,
    };
  }

  async loadDeckPdfWorkspace(
    deckId: string,
  ): Promise<PdfWorkspaceSnapshot | null> {
    const deck = await this.getDeck(deckId);
    if (!deck) {
      return null;
    }

    const conference = await this.getConference(deck.conferenceId);
    const talk = await this.getTalk(deck.talkId);
    if (!conference || !talk) {
      return null;
    }

    const slides = await this.listSlidesByDeck(deckId);
    const annotationsBySlide = new Map<string, Annotation[]>();
    for (const slide of slides) {
      annotationsBySlide.set(
        slide.id,
        await this.listAnnotationsBySlide(slide.id),
      );
    }
    const viewState = await this.getViewState(deckId);
    const history = await this.getWorkspaceHistory(deckId);
    const revision = await this.getWorkspaceRevision(deckId);

    return {
      sourceUrl: deck.sourceUrl,
      conferenceId: conference.id,
      talkId: talk.id,
      deckId,
      pageCount: slides.length,
      revision,
      ...(history ? { history } : {}),
      undoStack: viewState?.undoStack ?? [],
      redoStack: viewState?.redoStack ?? [],
      strokesByPage: slides.map((slide) =>
        (annotationsBySlide.get(slide.id) ?? [])
          .filter(
            (annotation): annotation is PenStroke =>
              'points' in annotation && annotation.points.length > 0,
          )
          .map((annotation) => ({
            id: annotation.id,
            pageNumber: slide.slideNumber,
            ...(annotation.baseWidth === undefined
              ? {}
              : { baseWidth: annotation.baseWidth }),
            ...(annotation.color === undefined
              ? {}
              : { color: annotation.color }),
            points: annotation.points,
          })),
      ),
      textNotesByPage: slides.map((slide) =>
        (annotationsBySlide.get(slide.id) ?? [])
          .filter(
            (annotation): annotation is TextNote =>
              !('points' in annotation) && typeof annotation.text === 'string',
          )
          .map((annotation) => ({
            id: annotation.id,
            conferenceId: annotation.conferenceId,
            talkId: annotation.talkId,
            deckId: annotation.deckId,
            slideId: slide.id,
            x: annotation.x,
            y: annotation.y,
            width: annotation.width,
            text: annotation.text,
            createdAt: annotation.createdAt,
            updatedAt: annotation.updatedAt,
          })),
      ),
      currentSlideNumber: viewState?.currentSlideNumber ?? 1,
      scrollLeft: viewState?.scrollLeft ?? 0,
      scrollTop: viewState?.scrollTop ?? 0,
      zoom: viewState?.zoom ?? 1,
    };
  }

  async saveLocalPdfWorkspace(
    state: PdfWorkspaceSnapshot,
  ): Promise<PdfWorkspaceSaveResult> {
    const now = this.now();
    const conferenceId = createConferenceId(state.sourceUrl);
    const talkId = createTalkId(conferenceId, state.sourceUrl);
    const deckId = createDeckId(talkId, state.sourceUrl);
    const fileName = getFileName(state.sourceUrl);
    const conference: Conference = {
      id: conferenceId,
      sourceUrl: state.sourceUrl,
      title: fileName || 'Local PDF workspace',
      dates: 'Local workspace',
      host: 'IndicoInk',
      timeZone: 'UTC',
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const talk: Talk = {
      id: talkId,
      conferenceId,
      contributionId: state.sourceUrl,
      contributionUrl: state.sourceUrl,
      title: fileName || 'Local PDF workspace',
      speaker: '',
      sessionTitle: 'Local PDF preview',
      startsAt: null,
      endsAt: null,
      room: '',
      bookmarked: false,
      createdAt: now,
      updatedAt: now,
    };
    const deck: Deck = {
      id: deckId,
      conferenceId,
      talkId,
      sourceUrl: state.sourceUrl,
      displayName: fileName || 'Local PDF workspace',
      mimeType: 'application/pdf',
      selected: true,
      createdAt: now,
      updatedAt: now,
    };
    const textNotesByPage = state.textNotesByPage ?? [];

    await this.transaction(async () => {
      await this.upsertConference(conference);
      await this.upsertTalk(talk);
      await this.upsertDeck(deck);
      await this.deleteSlidesByDeck(deckId);

      for (let pageIndex = 0; pageIndex < state.pageCount; pageIndex += 1) {
        const slideNumber = pageIndex + 1;
        const slideId = createSlideId(deckId, slideNumber);
        const pageStrokes = state.strokesByPage[pageIndex] ?? [];
        const pageTextNotes = textNotesByPage[pageIndex] ?? [];
        const annotated = pageStrokes.length > 0 || pageTextNotes.length > 0;

        await this.upsertSlide({
          id: slideId,
          conferenceId,
          talkId,
          deckId,
          slideNumber,
          annotated,
          createdAt: now,
          updatedAt: now,
        });

        for (const stroke of pageStrokes) {
          await this.upsertAnnotation({
            id: stroke.id,
            conferenceId,
            talkId,
            deckId,
            slideId,
            ...(stroke.baseWidth === undefined
              ? {}
              : { baseWidth: stroke.baseWidth }),
            ...(stroke.color === undefined ? {} : { color: stroke.color }),
            points: stroke.points,
            createdAt: now,
            updatedAt: now,
          });
        }

        for (const note of pageTextNotes) {
          await this.upsertAnnotation({
            id: note.id,
            conferenceId,
            talkId,
            deckId,
            slideId,
            x: note.x,
            y: note.y,
            width: note.width,
            text: note.text,
            createdAt: note.createdAt ?? now,
            updatedAt: note.updatedAt ?? now,
          });
        }
      }

      await this.upsertViewState({
        id: createViewStateId(deckId),
        conferenceId,
        talkId,
        deckId,
        slideId: state.currentSlideNumber
          ? createSlideId(deckId, state.currentSlideNumber)
          : null,
        currentSlideNumber: state.currentSlideNumber,
        zoom: state.zoom,
        scrollLeft: state.scrollLeft,
        scrollTop: state.scrollTop,
        undoStack: state.undoStack ?? [],
        redoStack: state.redoStack ?? [],
        createdAt: now,
        updatedAt: now,
      });
      if (state.history) {
        await this.replaceWorkspaceHistory(deckId, state.history);
      }
    });

    return {
      sourceUrl: state.sourceUrl,
      pageCount: state.pageCount,
      savedAt: now,
    };
  }

  async saveDeckPdfWorkspace(
    state: PdfWorkspaceSnapshot,
  ): Promise<PdfWorkspaceSaveResult> {
    const conferenceId = state.conferenceId;
    const talkId = state.talkId;
    const deckId = state.deckId;
    if (!conferenceId || !talkId || !deckId) {
      return this.saveLocalPdfWorkspace(state);
    }

    const now = this.now();
    const conference = await this.getConference(conferenceId);
    const talk = await this.getTalk(talkId);
    const deck = await this.getDeck(deckId);
    if (!conference || !talk || !deck) {
      throw new Error('Cannot save a deck workspace for an unknown deck.');
    }
    const textNotesByPage = state.textNotesByPage ?? [];

    await this.transaction(async () => {
      await this.deleteSlidesByDeck(deckId);

      for (let pageIndex = 0; pageIndex < state.pageCount; pageIndex += 1) {
        const slideNumber = pageIndex + 1;
        const slideId = createSlideId(deckId, slideNumber);
        const pageStrokes = state.strokesByPage[pageIndex] ?? [];
        const pageTextNotes = textNotesByPage[pageIndex] ?? [];
        const annotated = pageStrokes.length > 0 || pageTextNotes.length > 0;

        await this.upsertSlide({
          id: slideId,
          conferenceId,
          talkId,
          deckId,
          slideNumber,
          annotated,
          createdAt: now,
          updatedAt: now,
        });

        for (const stroke of pageStrokes) {
          await this.upsertAnnotation({
            id: stroke.id,
            conferenceId,
            talkId,
            deckId,
            slideId,
            ...(stroke.baseWidth === undefined
              ? {}
              : { baseWidth: stroke.baseWidth }),
            ...(stroke.color === undefined ? {} : { color: stroke.color }),
            points: stroke.points,
            createdAt: now,
            updatedAt: now,
          });
        }

        for (const note of pageTextNotes) {
          await this.upsertAnnotation({
            id: note.id,
            conferenceId,
            talkId,
            deckId,
            slideId,
            x: note.x,
            y: note.y,
            width: note.width,
            text: note.text,
            createdAt: note.createdAt ?? now,
            updatedAt: note.updatedAt ?? now,
          });
        }
      }

      await this.upsertViewState({
        id: createViewStateId(deckId),
        conferenceId,
        talkId,
        deckId,
        slideId: state.currentSlideNumber
          ? createSlideId(deckId, state.currentSlideNumber)
          : null,
        currentSlideNumber: state.currentSlideNumber,
        zoom: state.zoom,
        scrollLeft: state.scrollLeft,
        scrollTop: state.scrollTop,
        undoStack: state.undoStack ?? [],
        redoStack: state.redoStack ?? [],
        createdAt: now,
        updatedAt: now,
      });
      if (state.history) {
        await this.replaceWorkspaceHistory(deckId, state.history);
      }
    });

    return {
      sourceUrl: deck.sourceUrl,
      pageCount: state.pageCount,
      savedAt: now,
    };
  }

  async saveLocalPdfWorkspaceChanges(
    state: PdfWorkspaceChangeBatch,
  ): Promise<PdfWorkspaceChangeSaveResult> {
    const now = this.now();
    const conferenceId = createConferenceId(state.sourceUrl);
    const talkId = createTalkId(conferenceId, state.sourceUrl);
    const deckId = createDeckId(talkId, state.sourceUrl);
    const fileName = getFileName(state.sourceUrl);
    const transactionStartedAt = performance.now();

    await this.transaction(async () => {
      await this.upsertConference({
        id: conferenceId,
        sourceUrl: state.sourceUrl,
        title: fileName || 'Local PDF workspace',
        dates: 'Local workspace',
        host: 'IndicoInk',
        timeZone: 'UTC',
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await this.upsertTalk({
        id: talkId,
        conferenceId,
        contributionId: state.sourceUrl,
        contributionUrl: state.sourceUrl,
        title: fileName || 'Local PDF workspace',
        speaker: '',
        sessionTitle: 'Local PDF preview',
        startsAt: null,
        endsAt: null,
        room: '',
        bookmarked: false,
        createdAt: now,
        updatedAt: now,
      });
      await this.upsertDeck({
        id: deckId,
        conferenceId,
        talkId,
        sourceUrl: state.sourceUrl,
        displayName: fileName || 'Local PDF workspace',
        mimeType: 'application/pdf',
        selected: true,
        createdAt: now,
        updatedAt: now,
      });
      await this.applyWorkspaceChanges(state, conferenceId, talkId, deckId);
    });

    return {
      sourceUrl: state.sourceUrl,
      pageCount: state.pageCount,
      revision: state.revision,
      transactionDurationMs: performance.now() - transactionStartedAt,
      savedAt: now,
    };
  }

  async saveDeckPdfWorkspaceChanges(
    state: PdfWorkspaceChangeBatch,
  ): Promise<PdfWorkspaceChangeSaveResult> {
    const { conferenceId, talkId, deckId } = state;
    if (!conferenceId || !talkId || !deckId) {
      return this.saveLocalPdfWorkspaceChanges(state);
    }
    const deck = await this.getDeck(deckId);
    if (!deck) {
      throw new Error('Cannot save a deck workspace for an unknown deck.');
    }
    const now = this.now();
    const transactionStartedAt = performance.now();

    await this.transaction(async () => {
      await this.applyWorkspaceChanges(state, conferenceId, talkId, deckId);
    });

    return {
      sourceUrl: deck.sourceUrl,
      pageCount: state.pageCount,
      revision: state.revision,
      transactionDurationMs: performance.now() - transactionStartedAt,
      savedAt: now,
    };
  }

  private async applyWorkspaceChanges(
    state: PdfWorkspaceChangeBatch,
    conferenceId: string,
    talkId: string,
    deckId: string,
  ) {
    const now = this.now();
    const currentRevision = await this.getWorkspaceRevision(deckId);
    if (state.revision <= currentRevision) {
      return;
    }
    const existingSlides = await this.listSlidesByDeck(deckId);
    const existingSlidesByNumber = new Map(
      existingSlides.map((slide) => [slide.slideNumber, slide]),
    );
    if (existingSlides.length !== state.pageCount) {
      for (let pageIndex = 0; pageIndex < state.pageCount; pageIndex += 1) {
        if (existingSlidesByNumber.has(pageIndex + 1)) {
          continue;
        }
        await this.upsertSlide({
          id: createSlideId(deckId, pageIndex + 1),
          conferenceId,
          talkId,
          deckId,
          slideNumber: pageIndex + 1,
          annotated: false,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    for (const change of state.changes) {
      const slideId = createSlideId(deckId, change.pageIndex + 1);
      if (change.kind === 'delete') {
        const annotation = await this.getAnnotation(change.annotationId);
        if (annotation?.deckId === deckId) {
          await this.recordLocalSyncAnnotationChange(
            'annotation.erase',
            annotation,
          );
          await this.deleteAnnotation(change.annotationId);
        }
      } else if (change.kind === 'upsert-stroke') {
        const annotation: PenStroke = {
          id: change.stroke.id,
          conferenceId,
          talkId,
          deckId,
          slideId,
          ...(change.stroke.baseWidth === undefined
            ? {}
            : { baseWidth: change.stroke.baseWidth }),
          ...(change.stroke.color === undefined
            ? {}
            : { color: change.stroke.color }),
          points: change.stroke.points,
          createdAt: now,
          updatedAt: now,
        };
        await this.upsertAnnotation(annotation);
        await this.recordLocalSyncAnnotationChange(
          'annotation.put',
          annotation,
        );
      } else {
        const annotation: TextNote = {
          ...change.note,
          conferenceId,
          talkId,
          deckId,
          slideId,
          updatedAt: now,
        };
        await this.upsertAnnotation(annotation);
        await this.recordLocalSyncAnnotationChange(
          'annotation.put',
          annotation,
        );
      }
    }

    await this.upsertViewState({
      id: createViewStateId(deckId),
      conferenceId,
      talkId,
      deckId,
      slideId: state.currentSlideNumber
        ? createSlideId(deckId, state.currentSlideNumber)
        : null,
      currentSlideNumber: state.currentSlideNumber,
      zoom: state.zoom,
      scrollLeft: state.scrollLeft,
      scrollTop: state.scrollTop,
      undoStack: [],
      redoStack: [],
      createdAt: now,
      updatedAt: now,
    });
    await this.replaceWorkspaceHistory(deckId, state.history);
    const db = await this.getDb();
    db.prepare(
      `INSERT INTO workspace_revision (deck_id, revision, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(deck_id) DO UPDATE SET
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
    ).run([deckId, state.revision, now]);
  }

  private async recordLocalSyncAnnotationChange(
    kind: 'annotation.put' | 'annotation.erase',
    annotation: Annotation,
  ) {
    const db = await this.getDb();
    const profileRow = db
      .prepare('SELECT * FROM sync_profile WHERE singleton_id = 1')
      .get() as Record<string, unknown> | undefined;
    if (!profileRow || typeof profileRow.workspace_id !== 'string') {
      return;
    }
    const workspaceId = String(profileRow.workspace_id);
    const deviceId = String(profileRow.device_id);
    const conference = await this.getConference(annotation.conferenceId);
    if (!conference || !isShareableSourceUrl(conference.sourceUrl)) {
      return;
    }
    const deck = await this.getDeck(annotation.deckId);
    if (!deck || deck.kind === 'notebook') return;
    if (kind === 'annotation.put') {
      db.prepare(
        'DELETE FROM sync_suppressed_annotations WHERE workspace_id = ? AND annotation_id = ?',
      ).run([workspaceId, annotation.id]);
    }

    const now = this.now();
    db.prepare(
      `INSERT OR IGNORE INTO sync_document_versions (
        deck_id, document_version, version_state, measured_at, updated_at
      ) VALUES (?, NULL, 'unknown', NULL, ?)`,
    ).run([annotation.deckId, now]);

    const versionRow = db
      .prepare(
        `SELECT annotation_version.annotation_id,
                annotation_version.document_version,
                document_version.document_version AS deck_document_version
         FROM sync_document_versions AS document_version
         LEFT JOIN sync_annotation_versions AS annotation_version
           ON annotation_version.deck_id = document_version.deck_id
          AND annotation_version.annotation_id = ?
         WHERE document_version.deck_id = ?`,
      )
      .get([annotation.id, annotation.deckId]) as
      | {
          annotation_id?: string | null;
          document_version?: string | null;
          deck_document_version?: string | null;
        }
      | undefined;
    // An older annotation keeps its unknown association even after the deck's
    // current PDF bytes have been measured. Only new annotations inherit it.
    const documentVersion = versionRow?.annotation_id
      ? (versionRow.document_version ?? null)
      : (versionRow?.deck_document_version ?? null);
    db.prepare(
      `INSERT OR IGNORE INTO sync_annotation_versions (
        annotation_id, deck_id, document_version, version_state,
        association_operation_id, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?)`,
    ).run([
      annotation.id,
      annotation.deckId,
      documentVersion,
      documentVersion === null ? 'unknown' : 'known',
      now,
    ]);
    const streamId = `deck:${annotation.deckId}`;
    const stateKey = `${workspaceId}:${streamId}`;
    const state = db
      .prepare('SELECT * FROM sync_stream_state WHERE stream_id = ?')
      .get(stateKey) as Record<string, unknown> | undefined;
    const sequence = Number(state?.next_sequence ?? 1);
    const localFrontier = JSON.parse(
      String(state?.local_frontier_json ?? '{}'),
    ) as Record<string, number>;
    const remoteFrontier = JSON.parse(
      String(state?.remote_frontier_json ?? '{}'),
    ) as Record<string, number>;
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      (localFrontier[deviceId] ?? 0) > sequence - 1
    ) {
      throw new Error('Local sync stream sequence is invalid.');
    }
    if ((remoteFrontier[deviceId] ?? 0) >= sequence) {
      throw new Error(
        'This device sequence is behind the shared library. Re-enroll this installation before publishing.',
      );
    }
    const context: Record<string, number> = { ...remoteFrontier };
    for (const [knownDevice, knownSequence] of Object.entries(localFrontier)) {
      context[knownDevice] = Math.max(context[knownDevice] ?? 0, knownSequence);
    }
    if (sequence > 1) context[deviceId] = sequence - 1;
    else delete context[deviceId];

    const payload =
      kind === 'annotation.put'
        ? {
            annotation: {
              ...annotation,
              kind: 'points' in annotation ? 'stroke' : 'text',
            },
            documentVersion,
            logicalNoteId: 'points' in annotation ? null : annotation.id,
            branchOfOperationId: null,
            resolves: [],
          }
        : { annotationId: annotation.id, documentVersion };
    const operation = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId,
      deviceId,
      sequence,
      operationId: randomUUID(),
      context,
      requires: [],
      kind,
      payload,
    });
    const operationJson = canonicalJson(operation);
    db.prepare(
      `INSERT INTO sync_outbox (
        operation_id, stream_id, device_id, sequence, operation_json,
        conference_id, state, created_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
    ).run([
      operation.operationId,
      stateKey,
      deviceId,
      sequence,
      operationJson,
      annotation.conferenceId,
      now,
    ]);
    db.prepare(
      `INSERT INTO sync_stream_state (
        stream_id, next_sequence, local_frontier_json,
        remote_frontier_json, snapshot_id, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?)
      ON CONFLICT(stream_id) DO UPDATE SET
        next_sequence = excluded.next_sequence,
        local_frontier_json = excluded.local_frontier_json,
        updated_at = excluded.updated_at`,
    ).run([
      stateKey,
      sequence + 1,
      JSON.stringify({ ...context, [deviceId]: sequence }),
      JSON.stringify(remoteFrontier),
      now,
    ]);
    this.markDirty();
  }

  private async recordLocalSyncOperation(
    streamId: string,
    conferenceId: string,
    kind: 'bookmark.set' | 'conference.metadata' | 'conference.delete',
    payload: Record<string, unknown>,
  ) {
    const db = await this.getDb();
    const profile = await this.getSyncProfile();
    if (!profile.workspaceId) return;
    const workspaceId = profile.workspaceId;
    const deviceId = profile.deviceId;
    const stateKey = `${workspaceId}:${streamId}`;
    const state = db
      .prepare('SELECT * FROM sync_stream_state WHERE stream_id = ?')
      .get(stateKey) as Record<string, unknown> | undefined;
    const sequence = Number(state?.next_sequence ?? 1);
    const localFrontier = JSON.parse(
      String(state?.local_frontier_json ?? '{}'),
    ) as Record<string, number>;
    const remoteFrontier = JSON.parse(
      String(state?.remote_frontier_json ?? '{}'),
    ) as Record<string, number>;
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      (localFrontier[deviceId] ?? 0) > sequence - 1 ||
      (remoteFrontier[deviceId] ?? 0) >= sequence
    ) {
      throw new Error('Local sync stream sequence is invalid.');
    }
    const context: Record<string, number> = { ...remoteFrontier };
    for (const [knownDevice, knownSequence] of Object.entries(localFrontier)) {
      context[knownDevice] = Math.max(context[knownDevice] ?? 0, knownSequence);
    }
    if (sequence > 1) context[deviceId] = sequence - 1;
    else delete context[deviceId];
    const operation = createOperation({
      format: 'indicoink-operation',
      version: 1,
      workspaceId,
      streamId,
      deviceId,
      sequence,
      operationId: randomUUID(),
      context,
      requires: [],
      kind,
      payload,
    });
    db.prepare(
      `INSERT INTO sync_outbox (
        operation_id, stream_id, device_id, sequence, operation_json,
        conference_id, state, created_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
    ).run([
      operation.operationId,
      stateKey,
      deviceId,
      sequence,
      canonicalJson(operation),
      conferenceId,
      this.now(),
    ]);
    db.prepare(
      `INSERT INTO sync_stream_state (
         stream_id, next_sequence, local_frontier_json,
         remote_frontier_json, snapshot_id, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?)
       ON CONFLICT(stream_id) DO UPDATE SET
         next_sequence = excluded.next_sequence,
         local_frontier_json = excluded.local_frontier_json,
         updated_at = excluded.updated_at`,
    ).run([
      stateKey,
      sequence + 1,
      canonicalJson({ ...context, [deviceId]: sequence }),
      canonicalJson(remoteFrontier),
      this.now(),
    ]);
    this.markDirty();
  }

  private async deleteSlidesByDeck(deckId: string) {
    const db = await this.getDb();
    db.prepare('DELETE FROM slides WHERE deck_id = ?').run(deckId);
    this.markDirty();
  }

  private async getDb(): Promise<SqliteDatabaseAdapter> {
    if (this.db) {
      return this.db;
    }

    if (!this.loadPromise) {
      this.loadPromise = this.initialize();
    }

    await this.loadPromise;
    return this.db as unknown as SqliteDatabaseAdapter;
  }

  private async initialize() {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    if (existsSync(this.dbPath)) {
      const inspectionDb = new DatabaseSync(this.dbPath, { readOnly: true });
      const currentVersion = Number(
        Object.values(
          inspectionDb.prepare('PRAGMA user_version;').get() ?? {},
        )[0] ?? 0,
      );
      inspectionDb.close();

      if (currentVersion < CURRENT_SCHEMA_VERSION) {
        await copyFile(
          this.dbPath,
          `${this.dbPath}${PRE_NODE_SQLITE_BACKUP_SUFFIX}`,
          constants.COPYFILE_EXCL,
        ).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') {
            throw error;
          }
        });
      }
    }

    const rawDb = new DatabaseSync(this.dbPath, {
      timeout: 5000,
    });
    const adapter = new SqliteDatabaseAdapter(rawDb);
    adapter.exec('PRAGMA foreign_keys = ON;');
    adapter.exec('PRAGMA journal_mode = DELETE;');
    adapter.exec('PRAGMA synchronous = FULL;');
    this.ensureSchema(adapter);
    this.db = adapter;
  }

  private ensureSchema(db: SqliteDatabaseAdapter) {
    const currentVersion = Number(
      db.pragma('user_version', { simple: true }) ?? 0,
    );
    if (currentVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Persistence schema version ${currentVersion} is newer than the supported version ${CURRENT_SCHEMA_VERSION}.`,
      );
    }

    for (
      let version = currentVersion + 1;
      version <= CURRENT_SCHEMA_VERSION;
      version += 1
    ) {
      const migration = migrations[version - 1];
      if (!migration) {
        continue;
      }

      migration(db);
      db.pragma(`user_version = ${version}`);
      this.markDirty();
    }
  }

  private markDirty() {
    // File-backed SQLite persists changes transactionally.
  }

  private async flushIfNeeded() {
    // File-backed SQLite does not require exporting and rewriting the database.
  }
}
