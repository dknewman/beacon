import { open } from '@op-engineering/op-sqlite';
import { createOpSqliteDatabase } from './createOpSqliteDatabase';
import type { SqlDatabase } from './SqlDatabase';

export const APP_DATABASE_NAME = 'beacon.sqlite';

/**
 * Opens the on-device database. This is the only module that imports the
 * SQLite library, so everything else stays testable without native code.
 */
export function openAppDatabase(name: string = APP_DATABASE_NAME): SqlDatabase {
  return createOpSqliteDatabase(open({ name }));
}
