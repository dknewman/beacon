export interface BleSession {
  id: string;
  deviceId: string;
  startedAt: string;
  endedAt?: string;
  packetCount: number;
}
