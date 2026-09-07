import {
  createOpSqliteDatabase,
  type OpSqliteConnection,
  type OpSqliteQueryResult,
  type OpSqliteScalar,
} from '../createOpSqliteDatabase';

interface Call {
  scope: 'connection' | 'transaction';
  sql: string;
  params: OpSqliteScalar[] | undefined;
}

function fakeConnection(rows: Array<Record<string, OpSqliteScalar>> = []) {
  const calls: Call[] = [];
  const events: string[] = [];
  const result: OpSqliteQueryResult = { rows };
  const connection: OpSqliteConnection = {
    execute: async (sql, params) => {
      calls.push({ scope: 'connection', sql, params });
      return result;
    },
    transaction: async work => {
      events.push('begin');
      try {
        await work({
          execute: async (sql, params) => {
            calls.push({ scope: 'transaction', sql, params });
            return result;
          },
        });
        events.push('commit');
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    },
    closeAsync: async () => {
      events.push('close');
    },
  };
  return { connection, calls, events };
}

describe('createOpSqliteDatabase', () => {
  it('forwards statements with their parameters and returns the rows', async () => {
    const { connection, calls } = fakeConnection([{ id: 'a', count: 2 }]);
    const db = createOpSqliteDatabase(connection);

    const rows = await db.execute('SELECT * FROM t WHERE id = ?', ['a']);

    expect(rows).toEqual([{ id: 'a', count: 2 }]);
    expect(calls).toEqual([
      { scope: 'connection', sql: 'SELECT * FROM t WHERE id = ?', params: ['a'] },
    ]);
  });

  it('passes an empty parameter list when none are given', async () => {
    const { connection, calls } = fakeConnection();
    await createOpSqliteDatabase(connection).execute('PRAGMA user_version');
    expect(calls[0]?.params).toEqual([]);
  });

  it('narrows booleans and binary values into the SQL value union', async () => {
    const { connection } = fakeConnection([
      { flag: true, other: false, blob: new Uint8Array([0, 15, 255]), nothing: null },
    ]);
    const rows = await createOpSqliteDatabase(connection).execute('SELECT 1');
    expect(rows).toEqual([{ flag: 1, other: 0, blob: '000fff', nothing: null }]);
  });

  it('runs transaction work inside the connection transaction and returns its result', async () => {
    const { connection, calls, events } = fakeConnection();
    const db = createOpSqliteDatabase(connection);

    const value = await db.transaction(async tx => {
      await tx.execute('INSERT INTO t VALUES (?)', [1]);
      return 'done';
    });

    expect(value).toBe('done');
    expect(events).toEqual(['begin', 'commit']);
    expect(calls).toEqual([
      { scope: 'transaction', sql: 'INSERT INTO t VALUES (?)', params: [1] },
    ]);
  });

  it('rolls back and rethrows when the work fails', async () => {
    const { connection, events } = fakeConnection();
    const db = createOpSqliteDatabase(connection);

    await expect(
      db.transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(events).toEqual(['begin', 'rollback']);
  });

  it('closes the underlying connection', async () => {
    const { connection, events } = fakeConnection();
    await createOpSqliteDatabase(connection).close();
    expect(events).toEqual(['close']);
  });
});
