import type { BleSession, SessionEvent, SessionEventInput } from '@beacon/ble-contracts';

export const HR_SERVICE = '0000180D-0000-1000-8000-00805F9B34FB';
export const HR_MEASUREMENT = '00002A37-0000-1000-8000-00805F9B34FB';
export const UART_TX = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';

export const session: BleSession = {
  id: 'ses-abc-1',
  deviceId: 'MOCK-HRM-0001',
  deviceName: 'Polar H10 1A2B3C',
  startedAt: '2026-01-02T10:31:02.102Z',
  endedAt: '2026-01-02T10:31:12.500Z',
  packetCount: 3,
  eventCount: 8,
};

const at = (seconds: number, millis = 0): string =>
  `2026-01-02T10:31:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}Z`;

/** One event of every kind, so a round trip exercises the whole union. */
export const eventInputs: SessionEventInput[] = [
  { kind: 'connection', state: 'connected', timestamp: at(2, 341) },
  { kind: 'rssi', rssi: -52, timestamp: at(2, 500) },
  {
    kind: 'services_discovered',
    serviceCount: 5,
    characteristicCount: 12,
    timestamp: at(3, 8),
  },
  {
    kind: 'subscription',
    serviceUuid: HR_SERVICE,
    characteristicUuid: HR_MEASUREMENT,
    enabled: true,
    timestamp: at(3, 200),
  },
  {
    kind: 'notification',
    serviceUuid: HR_SERVICE,
    characteristicUuid: HR_MEASUREMENT,
    bytes: [0x00, 0x48],
    timestamp: at(8, 522),
  },
  {
    kind: 'read',
    serviceUuid: HR_SERVICE,
    characteristicUuid: HR_MEASUREMENT,
    bytes: [0x00, 0x49],
    timestamp: at(9, 100),
  },
  {
    kind: 'write',
    serviceUuid: UART_TX,
    characteristicUuid: UART_TX,
    bytes: [],
    timestamp: at(10, 0),
  },
  {
    kind: 'error',
    error: { code: 'read_failed', message: 'The peripheral refused the read' },
    timestamp: at(11, 750),
  },
];

export const events: SessionEvent[] = eventInputs.map((input, index) => ({
  ...input,
  id: `${session.id}-${index + 1}`,
  sessionId: session.id,
  sequence: index + 1,
}));
