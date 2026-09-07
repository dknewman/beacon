import type { BleSession, SessionEvent, SessionEventInput } from '@beacon/ble-contracts';

export interface NewSession {
  deviceId: string;
  deviceName?: string;
  startedAt: string;
}

export interface ListEventsOptions {
  /** 1-based sequence to start from (inclusive); defaults to the first. */
  fromSequence?: number;
  limit?: number;
}

/**
 * Storage boundary for recorded sessions (PROJECT.md 20, 30). The recorder
 * and the screens only see this interface; SQLite sits behind it in the app
 * and an in-memory implementation stands in for tests.
 */
export interface SessionRepository {
  createSession(input: NewSession): Promise<BleSession>;
  /** Appends in order, assigning the next sequence numbers; atomic per call. */
  appendEvents(sessionId: string, events: readonly SessionEventInput[]): Promise<void>;
  endSession(sessionId: string, endedAt: string): Promise<void>;
  getSession(sessionId: string): Promise<BleSession | undefined>;
  /** Newest first. */
  listSessions(): Promise<BleSession[]>;
  /** In timeline order (ascending sequence). */
  listEvents(sessionId: string, options?: ListEventsOptions): Promise<SessionEvent[]>;
  deleteSession(sessionId: string): Promise<void>;
}

export class SessionNotFoundError extends Error {
  override readonly name = 'SessionNotFoundError';

  constructor(readonly sessionId: string) {
    super(`No session ${sessionId}`);
  }
}

let counter = 0;

/** Process-unique session id: sortable by creation time, unguessable enough for a file name. */
export function createSessionId(
  now: number = Date.now(),
  random: () => number = Math.random,
): string {
  counter += 1;
  const entropy = Math.floor(random() * 0xffffff)
    .toString(36)
    .padStart(5, '0');
  return `ses-${now.toString(36)}-${entropy}${counter.toString(36)}`;
}

export function eventIdOf(sessionId: string, sequence: number): string {
  return `${sessionId}-${sequence}`;
}
