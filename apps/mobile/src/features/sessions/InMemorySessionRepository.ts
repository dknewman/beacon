import {
  isPacketEvent,
  type BleSession,
  type SessionEvent,
  type SessionEventInput,
} from '@beacon/ble-contracts';
import {
  createSessionId,
  eventIdOf,
  SessionNotFoundError,
  type ListEventsOptions,
  type NewSession,
  type SessionRepository,
} from './SessionRepository';

/**
 * Reference implementation with the same semantics as the SQLite one: used by
 * Jest, and by anything that wants sessions without a database.
 */
export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, BleSession>();
  private readonly events = new Map<string, SessionEvent[]>();

  constructor(private readonly nextId: () => string = () => createSessionId()) {}

  createSession(input: NewSession): Promise<BleSession> {
    const session: BleSession = {
      id: this.nextId(),
      deviceId: input.deviceId,
      ...(input.deviceName === undefined ? {} : { deviceName: input.deviceName }),
      startedAt: input.startedAt,
      packetCount: 0,
      eventCount: 0,
    };
    this.sessions.set(session.id, session);
    this.events.set(session.id, []);
    return Promise.resolve({ ...session });
  }

  appendEvents(sessionId: string, inputs: readonly SessionEventInput[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    const stored = this.events.get(sessionId);
    if (session === undefined || stored === undefined) {
      return Promise.reject(new SessionNotFoundError(sessionId));
    }
    let packets = 0;
    for (const input of inputs) {
      const sequence = stored.length + 1;
      stored.push({ ...input, id: eventIdOf(sessionId, sequence), sessionId, sequence });
      if (isPacketEvent(input)) {
        packets += 1;
      }
    }
    this.sessions.set(sessionId, {
      ...session,
      eventCount: stored.length,
      packetCount: session.packetCount + packets,
    });
    return Promise.resolve();
  }

  endSession(sessionId: string, endedAt: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return Promise.reject(new SessionNotFoundError(sessionId));
    }
    this.sessions.set(sessionId, { ...session, endedAt });
    return Promise.resolve();
  }

  getSession(sessionId: string): Promise<BleSession | undefined> {
    const session = this.sessions.get(sessionId);
    return Promise.resolve(session === undefined ? undefined : { ...session });
  }

  listSessions(): Promise<BleSession[]> {
    const all = [...this.sessions.values()].map(session => ({ ...session }));
    all.sort((a, b) =>
      a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0,
    );
    return Promise.resolve(all);
  }

  listEvents(
    sessionId: string,
    options: ListEventsOptions = {},
  ): Promise<SessionEvent[]> {
    const stored = this.events.get(sessionId) ?? [];
    const from = Math.max(1, options.fromSequence ?? 1);
    const slice = stored.slice(
      from - 1,
      options.limit === undefined ? undefined : from - 1 + options.limit,
    );
    return Promise.resolve(slice.map(event => ({ ...event })));
  }

  deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.events.delete(sessionId);
    return Promise.resolve();
  }
}
