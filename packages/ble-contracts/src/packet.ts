export type PacketDirection = 'incoming' | 'outgoing';

export interface BlePacket {
  id: string;
  deviceId: string;
  serviceUuid: string;
  characteristicUuid: string;
  direction: PacketDirection;
  /** Unsigned byte values 0..255. Arrays cross the bridge; Uint8Array does not. */
  bytes: number[];
  /** ISO-8601 timestamp, millisecond precision. */
  timestamp: string;
}
