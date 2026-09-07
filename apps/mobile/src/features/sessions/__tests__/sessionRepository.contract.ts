import type { SessionEventInput } from '@beacon/ble-contracts';
import { SessionNotFoundError, type SessionRepository } from '../SessionRepository';

const SERVICE = '0000180D-0000-1000-8000-00805F9B34FB';
const CHARACTERISTIC = '00002A37-0000-1000-8000-00805F9B34FB';

const at = (seconds: number) =>
  `2026-09-07T10:00:${String(seconds).padStart(2, '0')}.000Z`;

/** The behaviour every SessionRepository must share; run against each implementation. */
export function describeSessionRepositoryContract(
  name: string,
  create: () => Promise<{ repository: SessionRepository; dispose: () => Promise<void> }>,
): void {
  describe(`${name} (repository contract)`, () => {
    let repository: SessionRepository;
    let dispose: () => Promise<void>;

    beforeEach(async () => {
      ({ repository, dispose } = await create());
    });

    afterEach(async () => {
      await dispose();
    });

    it('creates sessions with zero counts and lists them newest first', async () => {
      const first = await repository.createSession({
        deviceId: 'a',
        deviceName: 'Polar',
        startedAt: at(1),
      });
      const second = await repository.createSession({ deviceId: 'b', startedAt: at(5) });
      expect(first).toMatchObject({
        deviceId: 'a',
        deviceName: 'Polar',
        startedAt: at(1),
        packetCount: 0,
        eventCount: 0,
      });
      expect(first.endedAt).toBeUndefined();
      expect(second.deviceName).toBeUndefined();
      expect(first.id).not.toBe(second.id);
      const listed = await repository.listSessions();
      expect(listed.map(session => session.id)).toEqual([second.id, first.id]);
      expect(await repository.getSession(first.id)).toEqual(first);
      expect(await repository.getSession('missing')).toBeUndefined();
    });

    it('appends events in order with sequence numbers and counts packets', async () => {
      const session = await repository.createSession({ deviceId: 'a', startedAt: at(0) });
      const events: SessionEventInput[] = [
        { kind: 'connection', timestamp: at(1), state: 'ready' },
        {
          kind: 'services_discovered',
          timestamp: at(2),
          serviceCount: 3,
          characteristicCount: 7,
        },
        {
          kind: 'subscription',
          timestamp: at(3),
          serviceUuid: SERVICE,
          characteristicUuid: CHARACTERISTIC,
          enabled: true,
        },
        {
          kind: 'notification',
          timestamp: at(4),
          serviceUuid: SERVICE,
          characteristicUuid: CHARACTERISTIC,
          bytes: [0x00, 0x48],
        },
        { kind: 'rssi', timestamp: at(5), rssi: -58 },
      ];
      await repository.appendEvents(session.id, events.slice(0, 2));
      await repository.appendEvents(session.id, []);
      await repository.appendEvents(session.id, events.slice(2));
      await repository.appendEvents(session.id, [
        {
          kind: 'write',
          timestamp: at(6),
          serviceUuid: SERVICE,
          characteristicUuid: CHARACTERISTIC,
          bytes: [1],
        },
        {
          kind: 'error',
          timestamp: at(7),
          error: { code: 'disconnected', message: 'gone', nativeCode: '19' },
        },
        { kind: 'connection', timestamp: at(8), state: 'disconnected' },
      ]);

      const stored = await repository.listEvents(session.id);
      expect(stored.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(stored.map(event => event.kind)).toEqual([
        'connection',
        'services_discovered',
        'subscription',
        'notification',
        'rssi',
        'write',
        'error',
        'connection',
      ]);
      expect(stored[3]).toEqual({
        id: `${session.id}-4`,
        sessionId: session.id,
        sequence: 4,
        kind: 'notification',
        timestamp: at(4),
        serviceUuid: SERVICE,
        characteristicUuid: CHARACTERISTIC,
        bytes: [0x00, 0x48],
      });
      expect(stored[6]).toMatchObject({
        kind: 'error',
        error: { code: 'disconnected', message: 'gone', nativeCode: '19' },
      });
      expect(await repository.getSession(session.id)).toMatchObject({
        eventCount: 8,
        packetCount: 2,
      });
    });

    it('pages events by sequence', async () => {
      const session = await repository.createSession({ deviceId: 'a', startedAt: at(0) });
      await repository.appendEvents(
        session.id,
        Array.from({ length: 6 }, (_, index) => ({
          kind: 'rssi' as const,
          timestamp: at(index),
          rssi: -50 - index,
        })),
      );
      const page = await repository.listEvents(session.id, { fromSequence: 3, limit: 2 });
      expect(page.map(event => event.sequence)).toEqual([3, 4]);
      expect(await repository.listEvents(session.id, { fromSequence: 7 })).toEqual([]);
      expect((await repository.listEvents(session.id, { limit: 1 }))[0]?.sequence).toBe(
        1,
      );
      expect(await repository.listEvents('missing')).toEqual([]);
    });

    it('ends a session and keeps its events until deleted', async () => {
      const session = await repository.createSession({ deviceId: 'a', startedAt: at(0) });
      await repository.appendEvents(session.id, [
        { kind: 'connection', timestamp: at(1), state: 'ready' },
      ]);
      await repository.endSession(session.id, at(9));
      expect(await repository.getSession(session.id)).toMatchObject({
        endedAt: at(9),
        eventCount: 1,
      });
      await repository.deleteSession(session.id);
      expect(await repository.getSession(session.id)).toBeUndefined();
      expect(await repository.listEvents(session.id)).toEqual([]);
      expect(await repository.listSessions()).toEqual([]);
      await expect(repository.deleteSession(session.id)).resolves.toBeUndefined();
    });

    it('refuses to append to or end a session that does not exist', async () => {
      await expect(
        repository.appendEvents('missing', [
          { kind: 'connection', timestamp: at(1), state: 'ready' },
        ]),
      ).rejects.toBeInstanceOf(SessionNotFoundError);
      await expect(repository.endSession('missing', at(1))).rejects.toBeInstanceOf(
        SessionNotFoundError,
      );
    });
  });
}
