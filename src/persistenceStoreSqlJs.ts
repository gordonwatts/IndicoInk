import initSqlJs from 'sql.js';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { NormalizedPagePoint } from './inkGeometry';
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
  PdfWorkspaceSaveResult,
  PdfWorkspaceSnapshot,
  PdfWorkspacePageState,
} from './shared/pdfWorkspace';
import {
  createConferenceId,
  createDeckId,
  createSlideId,
  createTalkId,
  createViewStateId,
} from './persistenceModels';

type SqlJsDatabase = {
  exec(sql: string): Array<{
    columns: string[];
    values: Array<Array<unknown>>;
  }>;
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  close(): void;
  getRowsModified(): number;
};

type SqlJsStatement = {
  bind(params?: unknown): SqlJsStatement;
  run(params?: unknown): SqlJsStatement;
  step(): boolean;
  get(params?: unknown): unknown[] | undefined;
  getAsObject(params?: unknown): Record<string, unknown> | undefined;
  all(params?: unknown): Record<string, unknown>[];
  reset(): SqlJsStatement;
  free(): void;
};

type SqlJsModule = {
  Database: new (data?: Uint8Array | ArrayBuffer) => SqlJsDatabase;
};

const CURRENT_SCHEMA_VERSION = 2;

const getFileName = (value: string) => {
  const normalized = value.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
};

const toBoolean = (value: unknown) => value === 1 || value === true;

const serializePoints = (points: NormalizedPagePoint[]) =>
  JSON.stringify(points);

const createEmptyPageState = (): PdfWorkspacePageState => ({
  strokes: [],
  textNotes: [],
});

const serializeWorkspaceHistory = (history: PdfWorkspacePageState[][]) =>
  JSON.stringify(history);

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

const deserializePoints = (value: string): NormalizedPagePoint[] =>
  (() => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(
        (point): point is NormalizedPagePoint =>
          typeof point === 'object' &&
          point !== null &&
          typeof (point as Record<string, unknown>).x === 'number' &&
          typeof (point as Record<string, unknown>).y === 'number' &&
          typeof (point as Record<string, unknown>).pressure === 'number' &&
          typeof (point as Record<string, unknown>).time === 'number',
      );
    } catch {
      return [];
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
      last_opened_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS talks (
      id TEXT PRIMARY KEY,
      conference_id TEXT NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      contribution_id TEXT NOT NULL,
      title TEXT NOT NULL,
      speaker TEXT NOT NULL,
      session_title TEXT NOT NULL,
      starts_at INTEGER,
      ends_at INTEGER,
      room TEXT NOT NULL,
      bookmarked INTEGER NOT NULL DEFAULT 0,
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

const migrations = [migration1, migration2];

const rowToConference = (row: Record<string, unknown>): Conference => ({
  id: String(row.id),
  sourceUrl: String(row.source_url),
  title: String(row.title),
  dates: String(row.dates),
  host: String(row.host),
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
    points: deserializePoints(String(row.payload_json)),
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
  constructor(private readonly statement: SqlJsStatement) {}

  run(params?: unknown) {
    this.statement.run(normalizeParams(params));
    return {
      changes: 0,
      lastInsertRowid: 0,
    };
  }

  get(params?: unknown) {
    const normalizedParams = normalizeParams(params);
    if (normalizedParams !== undefined) {
      this.statement.bind(normalizedParams);
    }

    try {
      if (!this.statement.step()) {
        return undefined;
      }

      const row = this.statement.getAsObject();
      return row && Object.keys(row).length ? row : undefined;
    } finally {
      this.statement.reset();
    }
  }

  all(params?: unknown) {
    const normalizedParams = normalizeParams(params);
    if (normalizedParams !== undefined) {
      this.statement.bind(normalizedParams);
    }

    const rows: Record<string, unknown>[] = [];
    try {
      while (this.statement.step()) {
        const row = this.statement.getAsObject();
        if (row) {
          rows.push(row);
        }
      }
      return rows;
    } finally {
      this.statement.reset();
    }
  }
}

class SqliteDatabaseAdapter {
  constructor(private readonly db: SqlJsDatabase) {}

  pragma<T = unknown>(statement: string, options?: { simple?: boolean }): T {
    const trimmed = statement.trim();
    const sql = trimmed.toUpperCase().startsWith('PRAGMA')
      ? trimmed.endsWith(';')
        ? trimmed
        : `${trimmed};`
      : `PRAGMA ${trimmed};`;
    const results = this.db.exec(sql);

    if (options?.simple) {
      return (results[0]?.values[0]?.[0] ?? 0) as T;
    }

    return results as T;
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  prepare(sql: string) {
    return new SqliteStatementAdapter(this.db.prepare(sql));
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

  export() {
    return this.db.export();
  }

  getRowsModified() {
    return this.db.getRowsModified();
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

const normalizeParams = (params?: unknown) => {
  if (params === null || params === undefined) {
    return undefined;
  }

  if (Array.isArray(params)) {
    return params;
  }

  if (typeof params === 'object') {
    return Object.fromEntries(
      Object.entries(params as Record<string, unknown>).map(([key, value]) => [
        /^[@:$]/.test(key) ? key : `@${key}`,
        value,
      ]),
    );
  }

  return [params];
};

export class PersistenceStore {
  private db: SqliteDatabaseAdapter | null = null;
  private loadPromise: Promise<void> | null = null;
  private dirty = false;
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
          id, source_url, title, dates, host, last_opened_at, created_at, updated_at
        ) VALUES (
          @id, @sourceUrl, @title, @dates, @host, @lastOpenedAt, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          source_url = excluded.source_url,
          title = excluded.title,
          dates = excluded.dates,
          host = excluded.host,
          last_opened_at = excluded.last_opened_at,
          updated_at = excluded.updated_at
      `,
    ).run({
      ...conference,
      sourceUrl: conference.sourceUrl,
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
      .prepare('SELECT * FROM conferences ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map((row) => rowToConference(row));
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
          id, conference_id, contribution_id, title, speaker, session_title,
          starts_at, ends_at, room, bookmarked, created_at, updated_at
        ) VALUES (
          @id, @conferenceId, @contributionId, @title, @speaker, @sessionTitle,
          @startsAt, @endsAt, @room, @bookmarked, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          conference_id = excluded.conference_id,
          contribution_id = excluded.contribution_id,
          title = excluded.title,
          speaker = excluded.speaker,
          session_title = excluded.session_title,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          room = excluded.room,
          bookmarked = excluded.bookmarked,
          updated_at = excluded.updated_at
      `,
    ).run({
      ...talk,
      bookmarked: talk.bookmarked ? 1 : 0,
      conferenceId: talk.conferenceId,
      contributionId: talk.contributionId,
      sessionTitle: talk.sessionTitle,
      startsAt: talk.startsAt,
      endsAt: talk.endsAt,
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
          selected, created_at, updated_at
        ) VALUES (
          @id, @conferenceId, @talkId, @sourceUrl, @displayName, @mimeType,
          @selected, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          conference_id = excluded.conference_id,
          talk_id = excluded.talk_id,
          source_url = excluded.source_url,
          display_name = excluded.display_name,
          mime_type = excluded.mime_type,
          selected = excluded.selected,
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
        ? serializePoints(annotation.points)
        : JSON.stringify({
            x: annotation.x,
            y: annotation.y,
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

    return {
      sourceUrl,
      conferenceId: conference.id,
      talkId: talkId,
      deckId,
      pageCount: slides.length,
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

    return {
      sourceUrl: deck.sourceUrl,
      conferenceId: conference.id,
      talkId: talk.id,
      deckId,
      pageCount: slides.length,
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
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const talk: Talk = {
      id: talkId,
      conferenceId,
      contributionId: state.sourceUrl,
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
    });

    return {
      sourceUrl: deck.sourceUrl,
      pageCount: state.pageCount,
      savedAt: now,
    };
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
    const SQL = (await initSqlJs()) as SqlJsModule;

    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(this.dbPath));
    } catch {
      bytes = undefined;
    }

    const rawDb = bytes ? new SQL.Database(bytes) : new SQL.Database();
    const adapter = new SqliteDatabaseAdapter(rawDb);
    adapter.exec('PRAGMA foreign_keys = ON;');
    this.dirty = bytes === undefined;
    this.ensureSchema(adapter);
    this.db = adapter;
    if (this.dirty) {
      await this.flushIfNeeded();
    }
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
    this.dirty = true;
  }

  private async flushIfNeeded() {
    if (!this.db || !this.dirty || this.transactionDepth > 0) {
      return;
    }

    await writeFile(this.dbPath, this.db.export());
    this.dirty = false;
  }
}
