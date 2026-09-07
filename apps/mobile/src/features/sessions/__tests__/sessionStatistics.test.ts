import type { BleSession, SessionEvent, SessionEventInput } from '@beacon/ble-contracts';
import { summarizeSession } from '../sessionStatistics';

const HR = '0000180D-0000-1000-8000-00805F9B34FB';
const HRM = '00002A37-0000-1000-8000-00805F9B34FB';
const BAT = '0000180F-0000-1000-8000-00805F9B34FB';
const BATL = '00002A19-0000-1000-8000-00805F9B34FB';

const session: BleSession = {
  id: 'ses-1',
  deviceId: 'dev',
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:00:10.000Z',
  packetCount: 0,
  eventCount: 0,
};

function events(inputs: SessionEventInput[]): SessionEvent[] {
  return inputs.map((input, index) => ({
    ...input,
    id: `ses-1-${index + 1}`,
    sessionId: 'ses-1',
    sequence: index + 1,
  }));
}

const at = (seconds: number) =>
  `2026-01-01T00:00:${String(seconds).padStart(2, '0')}.000Z`;

describe('summarizeSession', () => {
  it('summarizes an empty session', () => {
    const stats = summarizeSession(session, []);
    expect(stats).toEqual({
      durationMs: 10_000,
      ended: true,
      eventCount: 0,
      packetCount: 0,
      countsByKind: {
        connection: 0,
        rssi: 0,
        services_discovered: 0,
        subscription: 0,
        read: 0,
        write: 0,
        notification: 0,
        error: 0,
      },
      bytesReceived: 0,
      bytesSent: 0,
      characteristics: [],
    });
  });

  it('counts kinds, bytes, rates and per-characteristic traffic', () => {
    const stats = summarizeSession(
      session,
      events([
        { kind: 'connection', state: 'connected', timestamp: at(1) },
        { kind: 'rssi', rssi: -50, timestamp: at(1) },
        { kind: 'rssi', rssi: -60, timestamp: at(2) },
        {
          kind: 'services_discovered',
          serviceCount: 3,
          characteristicCount: 7,
          timestamp: at(2),
        },
        {
          kind: 'subscription',
          serviceUuid: HR,
          characteristicUuid: HRM,
          enabled: true,
          timestamp: at(3),
        },
        {
          kind: 'notification',
          serviceUuid: HR,
          characteristicUuid: HRM,
          bytes: [0, 72],
          timestamp: at(4),
        },
        {
          kind: 'notification',
          serviceUuid: HR,
          characteristicUuid: HRM,
          bytes: [0, 73],
          timestamp: at(5),
        },
        {
          kind: 'read',
          serviceUuid: BAT,
          characteristicUuid: BATL,
          bytes: [90],
          timestamp: at(6),
        },
        {
          kind: 'write',
          serviceUuid: BAT,
          characteristicUuid: BATL,
          bytes: [1, 2, 3],
          timestamp: at(7),
        },
        {
          kind: 'error',
          error: { code: 'read_failed', message: 'nope' },
          timestamp: at(8),
        },
      ]),
    );

    expect(stats.eventCount).toBe(10);
    expect(stats.packetCount).toBe(4);
    expect(stats.countsByKind).toMatchObject({
      connection: 1,
      rssi: 2,
      services_discovered: 1,
      subscription: 1,
      notification: 2,
      read: 1,
      write: 1,
      error: 1,
    });
    expect(stats.bytesReceived).toBe(5);
    expect(stats.bytesSent).toBe(3);
    expect(stats.notificationsPerSecond).toBeCloseTo(0.2);
    expect(stats.rssi).toEqual({ min: -60, max: -50, average: -55, samples: 2 });
    expect(stats.characteristics).toEqual([
      // Equal packet counts fall back to the characteristic UUID.
      {
        serviceUuid: BAT,
        characteristicUuid: BATL,
        reads: 1,
        writes: 1,
        notifications: 0,
        bytes: 4,
        firstAt: at(6),
        lastAt: at(7),
      },
      {
        serviceUuid: HR,
        characteristicUuid: HRM,
        reads: 0,
        writes: 0,
        notifications: 2,
        bytes: 4,
        firstAt: at(4),
        lastAt: at(5),
      },
    ]);
  });

  it('measures an open session up to its newest event', () => {
    const { endedAt: _ended, ...open } = session;
    const stats = summarizeSession(
      open,
      events([{ kind: 'rssi', rssi: -40, timestamp: at(4) }]),
    );
    expect(stats.ended).toBe(false);
    expect(stats.durationMs).toBe(4_000);
    expect(stats.notificationsPerSecond).toBeUndefined();
  });

  it('never reports a negative duration', () => {
    const stats = summarizeSession(
      { ...session, endedAt: '2025-12-31T23:59:59.000Z' },
      [],
    );
    expect(stats.durationMs).toBe(0);
  });
});
