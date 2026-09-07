import {
  isPacketEvent,
  type BleSession,
  type SessionEvent,
  type SessionEventInput,
} from '@beacon/ble-contracts';
import { parseBleSession, parseSessionEventInput } from '@beacon/validation';
import type { SqlDatabase, SqlExecutor, SqlRow } from '../../storage/SqlDatabase';
import {
  createSessionId,
  eventIdOf,
  SessionNotFoundError,
  type ListEventsOptions,
  type NewSession,
  type SessionRepository,
} from './SessionRepository';

/**
 * Sessions in SQLite (PROJECT.md 30): a `sessions` row per recording and a
 * `session_events` row per event with the event's JSON in `payload`. Every
 * row read back goes through the runtime schema, so a corrupt or
 * hand-edited database surfaces as a validation problem rather than a crash
 * deep in a screen; rows that fail are reported through `onInvalidRow` and
 * skipped.
 */
export class SqliteSessionRepository implements SessionRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly options: {
      nextId?: () => string;
      onInvalidRow?: (context: string, reason: string) => void;
    } = {},
  ) {}

  async createSession(input: NewSession): Promise<BleSession> {
    const id = (this.options.nextId ?? (() => createSessionId()))();
    await this.db.execute(
      `INSERT INTO sessions (id, device_id, device_name, started_at) VALUES (?, ?, ?, ?)`,
      [id, input.deviceId, input.deviceName ?? null, input.startedAt],
    );
    return {
      id,
      deviceId: input.deviceId,
      ...(input.deviceName === undefined ? {} : { deviceName: input.deviceName }),
      startedAt: input.startedAt,
      packetCount: 0,
      eventCount: 0,
    };
  }

  async appendEvents(
    sessionId: string,
    inputs: readonly SessionEventInput[],
  ): Promise<void> {
    if (inputs.length === 0) {
      return;
    }
    await this.db.transaction(async tx => {
      const counts = await tx.execute(
        `SELECT event_count, packet_count FROM sessions WHERE id = ?`,
        [sessionId],
      );
      const row = counts[0];
      if (row === undefined) {
        throw new SessionNotFoundError(sessionId);
      }
      let sequence = Number(row.event_count ?? 0);
      let packets = Number(row.packet_count ?? 0);
      for (const input of inputs) {
        sequence += 1;
        if (isPacketEvent(input)) {
          packets += 1;
        }
        await tx.execute(
          `INSERT INTO session_events (session_id, sequence, timestamp, kind, payload)
           VALUES (?, ?, ?, ?, ?)`,
          [sessionId, sequence, input.timestamp, input.kind, JSON.stringify(input)],
        );
      }
      await tx.execute(
        `UPDATE sessions SET event_count = ?, packet_count = ? WHERE id = ?`,
        [sequence, packets, sessionId],
      );
    });
  }

  async endSession(sessionId: string, endedAt: string): Promise<void> {
    const rows = await this.db.execute(`SELECT id FROM sessions WHERE id = ?`, [
      sessionId,
    ]);
    if (rows.length === 0) {
      throw new SessionNotFoundError(sessionId);
    }
    await this.db.execute(`UPDATE sessions SET ended_at = ? WHERE id = ?`, [
      endedAt,
      sessionId,
    ]);
  }

  async getSession(sessionId: string): Promise<BleSession | undefined> {
    const rows = await this.db.execute(`SELECT * FROM sessions WHERE id = ?`, [
      sessionId,
    ]);
    const row = rows[0];
    return row === undefined ? undefined : this.toSession(row);
  }

  async listSessions(): Promise<BleSession[]> {
    const rows = await this.db.execute(
      `SELECT * FROM sessions ORDER BY started_at DESC, id DESC`,
    );
    return rows.flatMap(row => {
      const session = this.toSession(row);
      return session === undefined ? [] : [session];
    });
  }

  async listEvents(
    sessionId: string,
    options: ListEventsOptions = {},
  ): Promise<SessionEvent[]> {
    const from = Math.max(1, options.fromSequence ?? 1);
    const limit = options.limit ?? -1;
    const rows = await this.db.execute(
      `SELECT sequence, payload FROM session_events
       WHERE session_id = ? AND sequence >= ?
       ORDER BY sequence ASC
       LIMIT ?`,
      [sessionId, from, limit],
    );
    return rows.flatMap(row => {
      const event = this.toEvent(sessionId, row);
      return event === undefined ? [] : [event];
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.execute(`DELETE FROM session_events WHERE session_id = ?`, [sessionId]);
      await tx.execute(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
    });
  }

  private toSession(row: SqlRow): BleSession | undefined {
    const candidate = {
      id: row.id,
      deviceId: row.device_id,
      ...(row.device_name === null || row.device_name === undefined
        ? {}
        : { deviceName: row.device_name }),
      startedAt: row.started_at,
      ...(row.ended_at === null || row.ended_at === undefined
        ? {}
        : { endedAt: row.ended_at }),
      packetCount: row.packet_count,
      eventCount: row.event_count,
    };
    const parsed = parseBleSession(candidate);
    if (!parsed.ok) {
      this.options.onInvalidRow?.(`session ${String(row.id)}`, parsed.error.message);
      return undefined;
    }
    return parsed.value;
  }

  private toEvent(sessionId: string, row: SqlRow): SessionEvent | undefined {
    const sequence = Number(row.sequence);
    let payload: unknown;
    try {
      payload = JSON.parse(String(row.payload));
    } catch (error) {
      this.options.onInvalidRow?.(
        `event ${sessionId}#${sequence}`,
        error instanceof Error ? error.message : String(error),
      );
      return undefined;
    }
    const parsed = parseSessionEventInput(payload);
    if (!parsed.ok) {
      this.options.onInvalidRow?.(`event ${sessionId}#${sequence}`, parsed.error.message);
      return undefined;
    }
    return { ...parsed.value, id: eventIdOf(sessionId, sequence), sessionId, sequence };
  }
}

/** Opens the schema on a fresh or existing database before the repository uses it. */
export async function prepareSessionDatabase(
  db: SqlDatabase,
  migrateSchema: (db: SqlDatabase) => Promise<number[]>,
): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');
  await migrateSchema(db);
}

export type { SqlExecutor };
