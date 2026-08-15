import { constants, existsSync, mkdirSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
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
  createConferenceId,
  createDeckId,
  createNotebookDeckId,
  createSlideId,
  createTalkId,
  createViewStateId,
} from './persistenceModels';

const CURRENT_SCHEMA_VERSION = 9;
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
];

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
  kind: String(row.kind ?? 'pdf') as 'pdf' | 'notebook',
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
    const rows = db
      .prepare(
        'SELECT * FROM conferences ORDER BY COALESCE(last_opened_at, updated_at) DESC, updated_at DESC',
      )
      .all() as Record<string, unknown>[];
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
    db.prepare(
      'UPDATE talks SET bookmarked = ?, updated_at = ? WHERE id = ?',
    ).run([bookmarked ? 1 : 0, this.now(), id]);
    this.markDirty();
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
          await this.deleteAnnotation(change.annotationId);
        }
      } else if (change.kind === 'upsert-stroke') {
        await this.upsertAnnotation({
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
        });
      } else {
        await this.upsertAnnotation({
          ...change.note,
          conferenceId,
          talkId,
          deckId,
          slideId,
          updatedAt: now,
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
