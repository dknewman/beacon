import type { BlePacket, PacketDirection } from '@beacon/ble-contracts';

/**
 * Per-device packet log (PROJECT.md 16, 18): every read result, write, and
 * later every notification, as an immutable ring buffer. Newest first so the
 * screen never has to reverse it. Bounded so a chatty peripheral cannot grow
 * memory without limit; the session recorder (M8) persists what it needs.
 */
export type PacketLogState = Readonly<Record<string, readonly BlePacket[]>>;

export type PacketLogAction =
  | { type: 'packet_recorded'; packet: BlePacket }
  /** A flushed notification batch, oldest first; one state update for the whole burst. */
  | { type: 'packets_recorded'; packets: readonly BlePacket[] }
  | { type: 'log_cleared'; deviceId: string };

export const initialPacketLogState: PacketLogState = {};

export const DEFAULT_PACKET_LOG_CAPACITY = 500;

export function packetLogReducer(
  state: PacketLogState,
  action: PacketLogAction,
  capacity = DEFAULT_PACKET_LOG_CAPACITY,
): PacketLogState {
  switch (action.type) {
    case 'packet_recorded': {
      const existing = state[action.packet.deviceId] ?? [];
      const next = [action.packet, ...existing.slice(0, Math.max(0, capacity - 1))];
      return { ...state, [action.packet.deviceId]: next };
    }
    case 'packets_recorded': {
      if (action.packets.length === 0) {
        return state;
      }
      const byDevice = new Map<string, BlePacket[]>();
      for (const packet of action.packets) {
        const bucket = byDevice.get(packet.deviceId) ?? [];
        bucket.push(packet);
        byDevice.set(packet.deviceId, bucket);
      }
      const next = { ...state };
      byDevice.forEach((packets, deviceId) => {
        const existing = state[deviceId] ?? [];
        next[deviceId] = [...packets.reverse(), ...existing].slice(0, capacity);
      });
      return next;
    }
    case 'log_cleared': {
      if (state[action.deviceId] === undefined) {
        return state;
      }
      const { [action.deviceId]: _removed, ...rest } = state;
      return rest;
    }
  }
}

export function packetsOf(state: PacketLogState, deviceId: string): readonly BlePacket[] {
  return state[deviceId] ?? EMPTY;
}

/** Packets for one characteristic, newest first. */
export function packetsForCharacteristic(
  state: PacketLogState,
  deviceId: string,
  serviceUuid: string,
  characteristicUuid: string,
): BlePacket[] {
  return packetsOf(state, deviceId).filter(
    packet =>
      packet.serviceUuid === serviceUuid &&
      packet.characteristicUuid === characteristicUuid,
  );
}

const EMPTY: readonly BlePacket[] = [];

let sequence = 0;

/** Builds a packet with a process-unique id and the current time. */
export function createPacket(
  fields: Omit<BlePacket, 'id' | 'timestamp'> & { timestamp?: string },
): BlePacket {
  sequence += 1;
  return {
    id: `pkt-${Date.now().toString(36)}-${sequence}`,
    timestamp: fields.timestamp ?? new Date().toISOString(),
    deviceId: fields.deviceId,
    serviceUuid: fields.serviceUuid,
    characteristicUuid: fields.characteristicUuid,
    direction: fields.direction,
    bytes: fields.bytes,
  };
}

export function describeDirection(direction: PacketDirection): string {
  return direction === 'incoming' ? 'Incoming' : 'Outgoing';
}
