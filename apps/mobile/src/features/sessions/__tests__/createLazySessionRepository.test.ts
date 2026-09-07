import { createLazySessionRepository } from '../createLazySessionRepository';
import { InMemorySessionRepository } from '../InMemorySessionRepository';

describe('createLazySessionRepository', () => {
  it('opens once, on first use, and shares the result', async () => {
    let opens = 0;
    const inner = new InMemorySessionRepository();
    const repository = createLazySessionRepository(async () => {
      opens += 1;
      return inner;
    });
    expect(opens).toBe(0);

    const created = await repository.createSession({
      deviceId: 'dev',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    await repository.appendEvents(created.id, [
      { kind: 'rssi', rssi: -1, timestamp: '2026-01-01T00:00:01.000Z' },
    ]);

    expect(opens).toBe(1);
    expect((await repository.getSession(created.id))?.eventCount).toBe(1);
    expect(await inner.listSessions()).toHaveLength(1);
  });

  it('rejects each call while opening fails and retries on the next call', async () => {
    let attempts = 0;
    const repository = createLazySessionRepository(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('cannot open');
      }
      return new InMemorySessionRepository();
    });

    await expect(repository.listSessions()).rejects.toThrow('cannot open');
    await expect(repository.listSessions()).resolves.toEqual([]);
    expect(attempts).toBe(2);
  });
});
