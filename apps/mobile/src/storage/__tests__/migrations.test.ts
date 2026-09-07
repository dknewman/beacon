import { createSqlJsDatabase } from '../../../tests/fakes/SqlJsDatabase';
import {
  currentSchemaVersion,
  migrate,
  SCHEMA_MIGRATIONS,
  type Migration,
} from '../migrations';

describe('migrate', () => {
  it('brings a fresh database to the latest version and is idempotent', async () => {
    const db = await createSqlJsDatabase();
    expect(await currentSchemaVersion(db)).toBe(0);
    expect(await migrate(db)).toEqual(SCHEMA_MIGRATIONS.map(m => m.version));
    expect(await currentSchemaVersion(db)).toBe(SCHEMA_MIGRATIONS.at(-1)?.version);
    const tables = await db.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    expect(tables.map(row => row.name)).toEqual(['session_events', 'sessions']);
    expect(await migrate(db)).toEqual([]);
    await db.close();
  });

  it('applies only the migrations above the current version, in order', async () => {
    const db = await createSqlJsDatabase();
    const history: Migration[] = [
      ...SCHEMA_MIGRATIONS,
      {
        version: 2,
        description: 'test column',
        statements: ['ALTER TABLE sessions ADD COLUMN note TEXT'],
      },
    ];
    await migrate(db, SCHEMA_MIGRATIONS);
    expect(await migrate(db, history)).toEqual([2]);
    const columns = await db.execute(`PRAGMA table_info(sessions)`);
    expect(columns.map(row => row.name)).toContain('note');
    expect(await currentSchemaVersion(db)).toBe(2);
    await db.close();
  });

  it('rolls a failed migration back and leaves the version untouched', async () => {
    const db = await createSqlJsDatabase();
    await migrate(db);
    const broken: Migration[] = [
      ...SCHEMA_MIGRATIONS,
      {
        version: 2,
        description: 'partially invalid',
        statements: ['CREATE TABLE scratch (id INTEGER)', 'THIS IS NOT SQL'],
      },
    ];
    await expect(migrate(db, broken)).rejects.toThrow();
    expect(await currentSchemaVersion(db)).toBe(1);
    const tables = await db.execute(
      `SELECT name FROM sqlite_master WHERE name = 'scratch'`,
    );
    expect(tables).toEqual([]);
    await db.close();
  });

  it('rejects duplicate versions', async () => {
    const db = await createSqlJsDatabase();
    await expect(
      migrate(db, [...SCHEMA_MIGRATIONS, { ...(SCHEMA_MIGRATIONS[0] as Migration) }]),
    ).rejects.toThrow(/Duplicate migration version 1/);
    await db.close();
  });
});
