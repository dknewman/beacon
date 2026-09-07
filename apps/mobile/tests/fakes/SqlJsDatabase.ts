import initSqlJs, { type Database as SqlJsDb, type SqlValue as SqlJsValue } from 'sql.js';
import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from '../../src/storage/SqlDatabase';

/**
 * In-process SQLite for Jest, so the migrations and the SQL the repositories
 * run are exercised against a real SQLite engine rather than a fake. Not
 * shipped in the app: the device uses the native SQLite adapter.
 */
export async function createSqlJsDatabase(): Promise<SqlDatabase> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const executor: SqlExecutor = {
    execute: (sql, params = []) => Promise.resolve(run(db, sql, params)),
  };
  let depth = 0;
  return {
    execute: executor.execute,
    async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      if (depth > 0) {
        throw new Error('Nested transactions are not supported');
      }
      depth += 1;
      db.run('BEGIN');
      try {
        const result = await work(executor);
        db.run('COMMIT');
        return result;
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      } finally {
        depth -= 1;
      }
    },
    close: () => {
      db.close();
      return Promise.resolve();
    },
  };
}

function run(db: SqlJsDb, sql: string, params: readonly SqlValue[]): SqlRow[] {
  const statement = db.prepare(sql);
  try {
    statement.bind(params as SqlJsValue[]);
    const rows: SqlRow[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      const mapped: Record<string, SqlValue> = {};
      for (const [column, value] of Object.entries(row)) {
        mapped[column] =
          value === null || typeof value === 'number' || typeof value === 'string'
            ? value
            : value instanceof Uint8Array
              ? Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')
              : String(value);
      }
      rows.push(mapped);
    }
    return rows;
  } finally {
    statement.free();
  }
}
