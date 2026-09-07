import type { BleSession } from '@beacon/ble-contracts';
import {
  describeRecording,
  describeSessionAction,
  describeSessionEvent,
  formatDuration,
  formatSessionStart,
  labelSession,
} from '../sessionPresentation';

const HR = '0000180D-0000-1000-8000-00805F9B34FB';
const HRM = '00002A37-0000-1000-8000-00805F9B34FB';
const VENDOR = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const AT = '2026-09-07T10:31:02.102Z';

const session: BleSession = {
  id: 'ses-1',
  deviceId: 'scale',
  deviceName: 'QN Scale',
  startedAt: '2026-09-07T10:31:00.000Z',
  endedAt: '2026-09-07T10:32:05.000Z',
  packetCount: 12,
  eventCount: 20,
};

describe('formatDuration', () => {
  it('shows seconds, then minutes with padded seconds, then hours with padded minutes', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(999)).toBe('0 s');
    expect(formatDuration(12_400)).toBe('12 s');
    expect(formatDuration(65_000)).toBe('1 min 05 s');
    expect(formatDuration(600_000)).toBe('10 min 00 s');
    expect(formatDuration(3_720_000)).toBe('1 h 02 min');
    expect(formatDuration(3_720_999)).toBe('1 h 02 min');
    expect(formatDuration(-5_000)).toBe('0 s');
  });
});

describe('formatSessionStart', () => {
  it('formats the local date and time to the second', () => {
    const local = new Date(2026, 8, 7, 10, 31, 2, 500);
    expect(formatSessionStart(local.toISOString())).toBe('7 Sep 2026, 10:31:02');
  });

  it('returns unparseable input unchanged', () => {
    expect(formatSessionStart('not a date')).toBe('not a date');
  });
});

describe('describeSessionEvent', () => {
  it('names connection states in upper case', () => {
    expect(
      describeSessionEvent({ kind: 'connection', state: 'connected', timestamp: AT }),
    ).toEqual({ title: 'CONNECTED' });
    expect(
      describeSessionEvent({
        kind: 'connection',
        state: 'discovering_services',
        timestamp: AT,
      }),
    ).toEqual({ title: 'DISCOVERING SERVICES' });
    expect(
      describeSessionEvent({ kind: 'connection', state: 'failed', timestamp: AT }),
    ).toEqual({ title: 'FAILED' });
  });

  it('shows RSSI in dBm', () => {
    expect(describeSessionEvent({ kind: 'rssi', rssi: -52, timestamp: AT })).toEqual({
      title: 'RSSI',
      detail: '-52 dBm',
    });
  });

  it('counts discovered services and characteristics', () => {
    expect(
      describeSessionEvent({
        kind: 'services_discovered',
        serviceCount: 5,
        characteristicCount: 12,
        timestamp: AT,
      }),
    ).toEqual({ title: 'SERVICES DISCOVERED', detail: '5 services, 12 characteristics' });
    expect(
      describeSessionEvent({
        kind: 'services_discovered',
        serviceCount: 1,
        characteristicCount: 1,
        timestamp: AT,
      }),
    ).toEqual({ title: 'SERVICES DISCOVERED', detail: '1 service, 1 characteristic' });
  });

  it('labels subscriptions with short UUIDs', () => {
    expect(
      describeSessionEvent({
        kind: 'subscription',
        serviceUuid: HR,
        characteristicUuid: HRM,
        enabled: true,
        timestamp: AT,
      }),
    ).toEqual({ title: 'SUBSCRIBED', detail: '180D / 2A37' });
    expect(
      describeSessionEvent({
        kind: 'subscription',
        serviceUuid: HR,
        characteristicUuid: HRM,
        enabled: false,
        timestamp: AT,
      }),
    ).toEqual({ title: 'UNSUBSCRIBED', detail: '180D / 2A37' });
  });

  it('shows packets as path and hex, keeping vendor UUIDs in full', () => {
    expect(
      describeSessionEvent({
        kind: 'notification',
        serviceUuid: HR,
        characteristicUuid: HRM,
        bytes: [0x00, 0x48],
        timestamp: AT,
      }),
    ).toEqual({ title: 'NOTIFICATION', detail: '180D / 2A37 · 00 48' });
    expect(
      describeSessionEvent({
        kind: 'read',
        serviceUuid: HR,
        characteristicUuid: HRM,
        bytes: [],
        timestamp: AT,
      }),
    ).toEqual({ title: 'READ', detail: '180D / 2A37 · (empty)' });
    expect(
      describeSessionEvent({
        kind: 'write',
        serviceUuid: VENDOR,
        characteristicUuid: HRM,
        bytes: [0x02, 0x9a, 0x1c],
        timestamp: AT,
      }),
    ).toEqual({ title: 'WRITE', detail: `${VENDOR} / 2A37 · 02 9A 1C` });
  });

  it('shows errors with their code', () => {
    expect(
      describeSessionEvent({
        kind: 'error',
        error: { code: 'disconnected', message: 'The peripheral closed the connection' },
        timestamp: AT,
      }),
    ).toEqual({
      title: 'ERROR',
      detail: 'The peripheral closed the connection (disconnected)',
    });
  });
});

describe('describeRecording', () => {
  it('invites a first recording while idle', () => {
    expect(describeRecording({ phase: 'idle' })).toEqual({
      value: 'Not recording',
      detail: 'Press Start session to record what happens on this link.',
    });
  });

  it('summarizes the last session while idle, with the last error when any', () => {
    expect(describeRecording({ phase: 'idle', lastSession: session })).toEqual({
      value: 'Not recording',
      detail: 'Last session: 20 events, 12 packets.',
    });
    expect(
      describeRecording({
        phase: 'idle',
        lastSession: { ...session, eventCount: 1, packetCount: 1 },
        lastError: 'disk full',
      }),
    ).toEqual({
      value: 'Not recording',
      detail: 'Last session: 1 event, 1 packet. disk full',
    });
    expect(describeRecording({ phase: 'idle', lastError: 'disk full' })).toEqual({
      value: 'Not recording',
      detail: 'Press Start session to record what happens on this link. disk full',
    });
  });

  it('describes starting and stopping', () => {
    expect(describeRecording({ phase: 'starting', startedAt: AT })).toEqual({
      value: 'Starting',
      detail: 'Creating the session.',
    });
    expect(
      describeRecording({
        phase: 'stopping',
        session,
        eventCount: 3,
        packetCount: 1,
        droppedCount: 0,
      }),
    ).toEqual({ value: 'Stopping', detail: 'Writing the last events.' });
  });

  it('shows live counts while recording, with drops and errors when any', () => {
    expect(
      describeRecording({
        phase: 'recording',
        session,
        eventCount: 7,
        packetCount: 2,
        droppedCount: 0,
      }),
    ).toEqual({ value: 'Recording', detail: '7 events · 2 packets' });
    expect(
      describeRecording({
        phase: 'recording',
        session,
        eventCount: 7,
        packetCount: 2,
        droppedCount: 3,
        lastError: 'disk full',
      }),
    ).toEqual({
      value: 'Recording',
      detail: '7 events · 2 packets · 3 dropped disk full',
    });
  });
});

describe('describeSessionAction', () => {
  it('offers start while idle and stop while recording, disabled in between', () => {
    expect(describeSessionAction({ phase: 'idle' })).toEqual({
      label: 'Start session',
      enabled: true,
      kind: 'start',
    });
    expect(describeSessionAction({ phase: 'starting', startedAt: AT })).toEqual({
      label: 'Starting…',
      enabled: false,
      kind: 'start',
    });
    expect(
      describeSessionAction({
        phase: 'recording',
        session,
        eventCount: 0,
        packetCount: 0,
        droppedCount: 0,
      }),
    ).toEqual({ label: 'Stop session', enabled: true, kind: 'stop' });
    expect(
      describeSessionAction({
        phase: 'stopping',
        session,
        eventCount: 0,
        packetCount: 0,
        droppedCount: 0,
      }),
    ).toEqual({ label: 'Stopping…', enabled: false, kind: 'stop' });
  });
});

describe('labelSession', () => {
  it('titles by device name and summarizes start, duration and packets', () => {
    expect(labelSession(session)).toEqual({
      title: 'QN Scale',
      subtitle: `${formatSessionStart(session.startedAt)} · 1 min 05 s · 12 packets`,
    });
  });

  it('falls back to the device id and says Recording while open', () => {
    const { endedAt: _ended, deviceName: _name, ...open } = session;
    expect(labelSession({ ...open, packetCount: 1 })).toEqual({
      title: 'scale',
      subtitle: `${formatSessionStart(session.startedAt)} · Recording · 1 packet`,
    });
  });
});
