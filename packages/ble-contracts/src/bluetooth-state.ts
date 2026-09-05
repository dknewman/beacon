/**
 * Bluetooth adapter state, normalized across platforms.
 *
 * iOS source: CBManagerState (CoreBluetooth).
 * Android source: BluetoothAdapter.getState() plus feature/adapter checks.
 *
 * Platform notes:
 * - "unauthorized" is a first-class adapter state on iOS (CBManagerState.unauthorized).
 *   On Android the equivalent is a permission outcome (see BlePermissionState); the
 *   Android adapter itself never reports "unauthorized".
 * - "resetting" is iOS-only. Android reports transitional "turning on/off" states
 *   which Beacon normalizes to "powered_off" until the adapter is actually on.
 */
export const BLUETOOTH_STATES = [
  'unknown',
  'unsupported',
  'unauthorized',
  'powered_off',
  'powered_on',
  'resetting',
] as const;

export type BluetoothState = (typeof BLUETOOTH_STATES)[number];

export function isBluetoothState(value: unknown): value is BluetoothState {
  return (
    typeof value === 'string' && (BLUETOOTH_STATES as readonly string[]).includes(value)
  );
}

/** True only when the radio can actually be used for scanning or connecting. */
export function isBluetoothUsable(state: BluetoothState): boolean {
  return state === 'powered_on';
}
