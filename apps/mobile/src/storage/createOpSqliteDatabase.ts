import type { SqlDatabase, SqlExecutor, SqlRow, SqlValue } from './SqlDatabase';

/**
 * The slice of an op-sqlite connection the adapter needs. Declared here
 * rather than imported so the adapter can be exercised in Jest with a plain
 * object, and so a change in the library's typings surfaces at this one
 * boundary.
 */
export interface OpSqliteConnection {
  execute(query: string, params?: OpSqliteScalar[]): Promise<OpSqliteQueryResult>;
  transaction(work: (tx: OpSqliteTransaction) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export interface OpSqliteTransaction {
  execute(query: string, params?: OpSqliteScalar[]): Promise<OpSqliteQueryResult>;
}

export type OpSqliteScalar =
  string | number | boolean | null | ArrayBuffer | ArrayBufferView;

export interface OpSqliteQueryResult {
  rows: Array<Record<string, OpSqliteScalar>>;
}

/**
 * Binds the app's SQL surface to an op-sqlite connection. Row values are
 * narrowed to the `SqlValue` union the repositories expect: booleans become
 * 0/1 and binary values become lowercase hex, neither of which the schema
 * currently produces.
 */
export function createOpSqliteDatabase(connection: OpSqliteConnection): SqlDatabase {
  const executor = (target: OpSqliteTransaction): SqlExecutor => ({
    async execute(sql, params = []) {
      const result = await target.execute(sql, [...params]);
      return result.rows.map(toSqlRow);
    },
  });

  return {
    ...executor(connection),
    async transaction(work) {
      let outcome: { value: unknown } | undefined;
      await connection.transaction(async tx => {
        outcome = { value: await work(executor(tx)) };
      });
      if (outcome === undefined) {
        throw new Error('The transaction completed without running its work');
      }
      return outcome.value as Awaited<ReturnType<typeof work>>;
    },
    close: () => connection.closeAsync(),
  };
}

function toSqlRow(row: Record<string, OpSqliteScalar>): SqlRow {
  const mapped: Record<string, SqlValue> = {};
  for (const [column, value] of Object.entries(row)) {
    mapped[column] = toSqlValue(value);
  }
  return mapped;
}

function toSqlValue(value: OpSqliteScalar): SqlValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
