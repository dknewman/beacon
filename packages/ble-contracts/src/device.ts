/**
 * A discovered BLE peripheral as seen by the application layer.
 *
 * `id` is platform specific and NOT portable across devices:
 * - iOS: CBPeripheral.identifier (a per-app, per-device UUID; MAC is hidden).
 * - Android: the hardware MAC address (may be randomized by the peripheral).
 */
export interface BleDevice {
  id: string;
  name?: string;
  localName?: string;
  rssi?: number;
  connectable?: boolean;
  /** Hex-encoded manufacturer data (no separators, uppercase), if advertised. */
  manufacturerData?: string;
  /** Advertised service UUIDs in canonical 128-bit uppercase form. */
  serviceUuids: string[];
  /** ISO-8601 timestamp of the most recent advertisement. */
  lastSeenAt: string;
}
