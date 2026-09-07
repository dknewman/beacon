/**
 * The narrow SQL surface the repositories use (PROJECT.md 30). The app binds
 * it to SQLite on the device; tests bind it to an in-process SQLite so the
 * same SQL and migrations run under Jest.
 */
export type SqlValue = string | number | null;

export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface SqlExecutor {
  /** Runs one statement; returns the rows a SELECT produced (empty otherwise). */
  execute(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
}

export interface SqlDatabase extends SqlExecutor {
  /** Runs `work` atomically: commits when it resolves, rolls back when it throws. */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
