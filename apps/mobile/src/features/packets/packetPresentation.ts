import { bytesToHex, type BlePacket } from '@beacon/ble-contracts';
import { describeDirection } from './packetLogReducer';

/** Local wall-clock time with milliseconds, e.g. "14:03:27.512"; packets need sub-second order. */
export function formatPacketTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
}

export interface PacketRowLabel {
  /** "Incoming" or "Outgoing". */
  direction: string;
  time: string;
  /** Hex dump, or "(empty)" for a zero-length value. */
  hex: string;
  byteCount: string;
  accessibilityLabel: string;
}

export function labelPacket(packet: BlePacket): PacketRowLabel {
  const direction = describeDirection(packet.direction);
  const time = formatPacketTime(packet.timestamp);
  const hex = packet.bytes.length === 0 ? '(empty)' : bytesToHex(packet.bytes);
  const byteCount = packet.bytes.length === 1 ? '1 byte' : `${packet.bytes.length} bytes`;
  return {
    direction,
    time,
    hex,
    byteCount,
    accessibilityLabel: `${direction} at ${time}, ${byteCount}: ${hex}`,
  };
}
