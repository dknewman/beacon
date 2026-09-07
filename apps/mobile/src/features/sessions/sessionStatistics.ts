import {
  isPacketEvent,
  type BleSession,
  type SessionEvent,
  type SessionEventKind,
} from '@beacon/ble-contracts';

/**
 * What a session detail screen summarizes (PROJECT.md M8 "Statistics").
 * Pure: computed from the stored session and its events, so the numbers can
 * be recomputed identically from an export.
 */
export interface SessionStatistics {
  /** From `startedAt` to `endedAt`, or to the newest event while still open. */
  durationMs: number;
  ended: boolean;
  eventCount: number;
  packetCount: number;
  countsByKind: Readonly<Record<SessionEventKind, number>>;
  bytesReceived: number;
  bytesSent: number;
  /** Notifications per second over the duration; undefined for a zero-length session. */
  notificationsPerSecond?: number;
  rssi?: { min: number; max: number; average: number; samples: number };
  /** Characteristics that carried values, busiest first. */
  characteristics: CharacteristicStatistics[];
}

export interface CharacteristicStatistics {
  serviceUuid: string;
  characteristicUuid: string;
  reads: number;
  writes: number;
  notifications: number;
  bytes: number;
  firstAt: string;
  lastAt: string;
}

const KINDS: readonly SessionEventKind[] = [
  'connection',
  'rssi',
  'services_discovered',
  'subscription',
  'read',
  'write',
  'notification',
  'error',
];

export function summarizeSession(
  session: BleSession,
  events: readonly SessionEvent[],
): SessionStatistics {
  const countsByKind = Object.fromEntries(KINDS.map(kind => [kind, 0])) as Record<
    SessionEventKind,
    number
  >;
  const byCharacteristic = new Map<string, CharacteristicStatistics>();
  let bytesReceived = 0;
  let bytesSent = 0;
  let packetCount = 0;
  let rssiSum = 0;
  let rssiMin = Number.POSITIVE_INFINITY;
  let rssiMax = Number.NEGATIVE_INFINITY;
  let rssiSamples = 0;
  let newest = session.startedAt;

  for (const event of events) {
    countsByKind[event.kind] += 1;
    if (event.timestamp > newest) {
      newest = event.timestamp;
    }
    if (event.kind === 'rssi') {
      rssiSamples += 1;
      rssiSum += event.rssi;
      rssiMin = Math.min(rssiMin, event.rssi);
      rssiMax = Math.max(rssiMax, event.rssi);
    }
    if (!isPacketEvent(event) || !('bytes' in event)) {
      continue;
    }
    packetCount += 1;
    if (event.kind === 'write') {
      bytesSent += event.bytes.length;
    } else {
      bytesReceived += event.bytes.length;
    }
    const key = `${event.serviceUuid}/${event.characteristicUuid}`;
    const entry = byCharacteristic.get(key) ?? {
      serviceUuid: event.serviceUuid,
      characteristicUuid: event.characteristicUuid,
      reads: 0,
      writes: 0,
      notifications: 0,
      bytes: 0,
      firstAt: event.timestamp,
      lastAt: event.timestamp,
    };
    if (event.kind === 'read') {
      entry.reads += 1;
    } else if (event.kind === 'write') {
      entry.writes += 1;
    } else {
      entry.notifications += 1;
    }
    entry.bytes += event.bytes.length;
    if (event.timestamp < entry.firstAt) {
      entry.firstAt = event.timestamp;
    }
    if (event.timestamp > entry.lastAt) {
      entry.lastAt = event.timestamp;
    }
    byCharacteristic.set(key, entry);
  }

  const end = session.endedAt ?? newest;
  const durationMs = Math.max(0, Date.parse(end) - Date.parse(session.startedAt));
  const characteristics = [...byCharacteristic.values()].sort(
    (a, b) =>
      packetsOf(b) - packetsOf(a) ||
      a.characteristicUuid.localeCompare(b.characteristicUuid),
  );

  return {
    durationMs,
    ended: session.endedAt !== undefined,
    eventCount: events.length,
    packetCount,
    countsByKind,
    bytesReceived,
    bytesSent,
    ...(durationMs > 0 && countsByKind.notification > 0
      ? { notificationsPerSecond: countsByKind.notification / (durationMs / 1000) }
      : {}),
    ...(rssiSamples > 0
      ? {
          rssi: {
            min: rssiMin,
            max: rssiMax,
            average: Math.round(rssiSum / rssiSamples),
            samples: rssiSamples,
          },
        }
      : {}),
    characteristics,
  };
}

function packetsOf(entry: CharacteristicStatistics): number {
  return entry.reads + entry.writes + entry.notifications;
}
