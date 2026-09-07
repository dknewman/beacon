import type { ConnectionState } from './connection-state';
import type { BleErrorInfo } from './errors';

/**
 * A recorded session (PROJECT.md 20): everything that happened on one link
 * between Start Session and Stop Session, persisted so it can be reviewed,
 * summarized and later exported.
 */
export interface BleSession {
  id: string;
  deviceId: string;
  /** Name shown in the device list when the session started, if any. */
  deviceName?: string;
  startedAt: string;
  endedAt?: string;
  /** Reads, writes and notifications; the values a person came for. */
  packetCount: number;
  /** Every event, packets included. */
  eventCount: number;
}

export type SessionEventKind =
  | 'connection'
  | 'rssi'
  | 'services_discovered'
  | 'subscription'
  | 'read'
  | 'write'
  | 'notification'
  | 'error';

/** What happened, without the identity the repository assigns on append. */
export type SessionEventInput = { timestamp: string } & (
  | { kind: 'connection'; state: ConnectionState }
  | { kind: 'rssi'; rssi: number }
  | { kind: 'services_discovered'; serviceCount: number; characteristicCount: number }
  | {
      kind: 'subscription';
      serviceUuid: string;
      characteristicUuid: string;
      enabled: boolean;
    }
  | { kind: 'read'; serviceUuid: string; characteristicUuid: string; bytes: number[] }
  | { kind: 'write'; serviceUuid: string; characteristicUuid: string; bytes: number[] }
  | {
      kind: 'notification';
      serviceUuid: string;
      characteristicUuid: string;
      bytes: number[];
    }
  | { kind: 'error'; error: BleErrorInfo }
);

/** A persisted event: input plus the session it belongs to and its place in the timeline. */
export type SessionEvent = SessionEventInput & {
  id: string;
  sessionId: string;
  /** 1-based position in the session; the timeline order. */
  sequence: number;
};

/** The kinds that carry a characteristic value and count as packets. */
export const PACKET_EVENT_KINDS: readonly SessionEventKind[] = [
  'read',
  'write',
  'notification',
];

export function isPacketEvent(event: SessionEventInput): boolean {
  return PACKET_EVENT_KINDS.includes(event.kind);
}
