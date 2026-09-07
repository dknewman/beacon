import type { SqlDatabase } from './SqlDatabase';

export interface Migration {
  /** Monotonic; the database's `user_version` after this migration applied. */
  version: number;
  description: string;
  statements: readonly string[];
}

/**
 * Schema history (PROJECT.md 30: support migrations from the beginning). Only
 * ever append; a released version's statements never change.
 */
export const SCHEMA_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'Sessions and their events',
    statements: [
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        packet_count INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX sessions_started_at ON sessions (started_at DESC)`,
      `CREATE TABLE session_events (
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (session_id, sequence)
      )`,
    ],
  },
];

export async function currentSchemaVersion(db: SqlDatabase): Promise<number> {
  const rows = await db.execute('PRAGMA user_version');
  const value = rows[0]?.user_version;
  return typeof value === 'number' ? value : 0;
}

/**
 * Applies every migration above the database's `user_version`, each in its
 * own transaction so a failure leaves the schema at a known version.
 * Returns the versions applied.
 */
export async function migrate(
  db: SqlDatabase,
  migrations: readonly Migration[] = SCHEMA_MIGRATIONS,
): Promise<number[]> {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (let index = 1; index < ordered.length; index += 1) {
    if (
      (ordered[index] as Migration).version === (ordered[index - 1] as Migration).version
    ) {
      throw new Error(
        `Duplicate migration version ${(ordered[index] as Migration).version}`,
      );
    }
  }
  const applied: number[] = [];
  let version = await currentSchemaVersion(db);
  for (const migration of ordered) {
    if (migration.version <= version) {
      continue;
    }
    await db.transaction(async tx => {
      for (const statement of migration.statements) {
        await tx.execute(statement);
      }
      await tx.execute(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
    applied.push(migration.version);
  }
  return applied;
}
