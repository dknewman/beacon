import type { SessionRepository } from './SessionRepository';

/**
 * Defers opening the store until the first call, so the composition root
 * stays synchronous and a database that fails to open surfaces as a failed
 * operation (with its message) rather than a crash at launch. A failed open
 * is retried on the next call.
 */
export function createLazySessionRepository(
  open: () => Promise<SessionRepository>,
): SessionRepository {
  let opening: Promise<SessionRepository> | undefined;
  const ready = (): Promise<SessionRepository> => {
    opening ??= open().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
    return opening;
  };
  return {
    createSession: input => ready().then(repository => repository.createSession(input)),
    appendEvents: (sessionId, events) =>
      ready().then(repository => repository.appendEvents(sessionId, events)),
    endSession: (sessionId, endedAt) =>
      ready().then(repository => repository.endSession(sessionId, endedAt)),
    getSession: sessionId => ready().then(repository => repository.getSession(sessionId)),
    listSessions: () => ready().then(repository => repository.listSessions()),
    listEvents: (sessionId, options) =>
      ready().then(repository => repository.listEvents(sessionId, options)),
    deleteSession: sessionId =>
      ready().then(repository => repository.deleteSession(sessionId)),
  };
}
