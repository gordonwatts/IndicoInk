declare module 'sql.js' {
  export type SqlJsConfig = {
    locateFile?: (file: string) => string;
  };

  export type SqlJsRow = Record<string, unknown>;

  export interface SqlJsStatement {
    run(params?: unknown): SqlJsStatement;
    get(params?: unknown): unknown[] | undefined;
    getAsObject(params?: unknown): SqlJsRow | undefined;
    all(params?: unknown): SqlJsRow[];
    free(): void;
  }

  export interface SqlJsDatabase {
    exec(sql: string): Array<{
      columns: string[];
      values: Array<Array<unknown>>;
    }>;
    prepare(sql: string): SqlJsStatement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | ArrayBuffer) => SqlJsDatabase;
  }

  export default function initSqlJs(
    config?: SqlJsConfig,
  ): Promise<SqlJsStatic>;
}

declare module 'sql.js/dist/sql-wasm.wasm?url' {
  const url: string;
  export default url;
}
