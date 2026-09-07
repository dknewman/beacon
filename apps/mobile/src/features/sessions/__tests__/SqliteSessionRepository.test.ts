import { createSqlJsDatabase } from '../../../../tests/fakes/SqlJsDatabase';
import type { SqlDatabase } from '../../../storage/SqlDatabase';
import {
  prepareSessionDatabase,
  SqliteSessionRepository,
} from '../SqliteSessionRepository';
import { describeSessionRepositoryContract } from './sessionRepository.contract';

async function openDatabase(): Promise<SqlDatabase> {
  const db = await createSqlJsDatabase();
  await prepareSessionDatabase(db);
  return db;
}

describeSessionRepositoryContract('SqliteSessionRepository', async () => {
  const db = await openDatabase();
  return { repository: new SqliteSessionRepository(db), dispose: () => db.close() };
});

describe('SqliteSessionRepository (SQLite specifics)', () => {
  it('appends atomically: a failure inside the batch leaves nothing behind', async () => {
    const db = await openDatabase();
    const repository = new SqliteSessionRepository(db);
    const session = await repository.createSession({
      deviceId: 'a',
      startedAt: '2026-09-07T10:00:00.000Z',
    });
    // A duplicate sequence is impossible through the API; simulate a mid-batch
    // failure by pre-inserting the row the second event would take.
    await db.execute(
      `INSERT INTO session_events (session_id, sequence, timestamp, kind, payload)
       VALUES (?, 2, '2026-09-07T10:00:00.000Z', 'rssi', '{}')`,
      [session.id],
    );
    await expect(
      repository.appendEvents(session.id, [
        { kind: 'rssi', timestamp: '2026-09-07T10:00:01.000Z', rssi: -50 },
        { kind: 'rssi', timestamp: '2026-09-07T10:00:02.000Z', rssi: -51 },
      ]),
    ).rejects.toThrow();
    const rows = await db.execute(
      `SELECT sequence FROM session_events WHERE session_id = ?`,
      [session.id],
    );
    expect(rows.map(row => row.sequence)).toEqual([2]);
    expect(await repository.getSession(session.id)).toMatchObject({ eventCount: 0 });
    await db.close();
  });

  it('validates persisted JSON on the way back and reports rows it cannot use', async () => {
    const db = await openDatabase();
    const invalid: string[] = [];
    const repository = new SqliteSessionRepository(db, {
      onInvalidRow: (context, reason) => invalid.push(`${context}: ${reason}`),
    });
    const session = await repository.createSession({
      deviceId: 'a',
      startedAt: '2026-09-07T10:00:00.000Z',
    });
    await repository.appendEvents(session.id, [
      { kind: 'rssi', timestamp: '2026-09-07T10:00:01.000Z', rssi: -50 },
    ]);
    await db.execute(
      `INSERT INTO session_events (session_id, sequence, timestamp, kind, payload)
       VALUES (?, 2, '2026-09-07T10:00:02.000Z', 'rssi', '{"kind":"rssi","timestamp":"2026-09-07T10:00:02.000Z","rssi":500}')`,
      [session.id],
    );
    await db.execute(
      `INSERT INTO session_events (session_id, sequence, timestamp, kind, payload)
       VALUES (?, 3, '2026-09-07T10:00:03.000Z', 'rssi', 'not json')`,
      [session.id],
    );
    const events = await repository.listEvents(session.id);
    expect(events.map(event => event.sequence)).toEqual([1]);
    expect(invalid).toHaveLength(2);
    expect(invalid[0]).toMatch(/event .*#2: Invalid persisted session event/);
    expect(invalid[1]).toMatch(/event .*#3: /);

    await db.execute(`UPDATE sessions SET started_at = 'yesterday' WHERE id = ?`, [
      session.id,
    ]);
    expect(await repository.listSessions()).toEqual([]);
    expect(await repository.getSession(session.id)).toBeUndefined();
    expect(invalid[2]).toMatch(/session .*: Invalid persisted session/);
    await db.close();
  });

  it('uses a stable, sortable session id', async () => {
    const db = await openDatabase();
    const repository = new SqliteSessionRepository(db, { nextId: () => 'ses-fixed' });
    const session = await repository.createSession({
      deviceId: 'a',
      startedAt: '2026-09-07T10:00:00.000Z',
    });
    expect(session.id).toBe('ses-fixed');
    await db.close();
  });
});
