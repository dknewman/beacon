import type { BleSession } from '@beacon/ble-contracts';
import type { SessionRepository } from './SessionRepository';

/**
 * Closes sessions a previous run left open (the app was killed or crashed
 * while recording). Their end is the newest event they hold, or their start
 * when nothing was recorded, so the history never shows a session as still
 * running when nothing is writing to it. Returns the sessions it closed.
 */
export async function recoverOpenSessions(
  repository: SessionRepository,
): Promise<BleSession[]> {
  const sessions = await repository.listSessions();
  const closed: BleSession[] = [];
  for (const session of sessions) {
    if (session.endedAt !== undefined) {
      continue;
    }
    const endedAt = await lastEventTimestamp(repository, session);
    await repository.endSession(session.id, endedAt);
    closed.push({ ...session, endedAt });
  }
  return closed;
}

async function lastEventTimestamp(
  repository: SessionRepository,
  session: BleSession,
): Promise<string> {
  if (session.eventCount === 0) {
    return session.startedAt;
  }
  const [last] = await repository.listEvents(session.id, {
    fromSequence: session.eventCount,
    limit: 1,
  });
  return last?.timestamp ?? session.startedAt;
}
