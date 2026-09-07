import { InMemorySessionRepository } from '../InMemorySessionRepository';
import { recoverOpenSessions } from '../recoverOpenSessions';

describe('recoverOpenSessions', () => {
  it('closes sessions without an end at their newest event, or their start when empty', async () => {
    const repository = new InMemorySessionRepository();
    const finished = await repository.createSession({
      deviceId: 'a',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    await repository.endSession(finished.id, '2026-01-01T00:01:00.000Z');
    const busy = await repository.createSession({
      deviceId: 'b',
      startedAt: '2026-01-01T00:02:00.000Z',
    });
    await repository.appendEvents(busy.id, [
      { kind: 'rssi', rssi: -50, timestamp: '2026-01-01T00:02:01.000Z' },
      { kind: 'rssi', rssi: -51, timestamp: '2026-01-01T00:02:02.000Z' },
    ]);
    const empty = await repository.createSession({
      deviceId: 'c',
      startedAt: '2026-01-01T00:03:00.000Z',
    });

    const closed = await recoverOpenSessions(repository);

    expect(closed.map(session => [session.id, session.endedAt])).toEqual([
      [empty.id, '2026-01-01T00:03:00.000Z'],
      [busy.id, '2026-01-01T00:02:02.000Z'],
    ]);
    expect((await repository.getSession(busy.id))?.endedAt).toBe(
      '2026-01-01T00:02:02.000Z',
    );
    expect((await repository.getSession(finished.id))?.endedAt).toBe(
      '2026-01-01T00:01:00.000Z',
    );
  });

  it('does nothing when every session is closed', async () => {
    const repository = new InMemorySessionRepository();
    await expect(recoverOpenSessions(repository)).resolves.toEqual([]);
  });
});
