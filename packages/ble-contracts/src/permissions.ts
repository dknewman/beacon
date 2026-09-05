/**
 * Permission outcome for Bluetooth usage, normalized across platforms.
 *
 * iOS: derived from CBManager.authorization.
 * Android: derived from runtime permission results for BLUETOOTH_SCAN /
 * BLUETOOTH_CONNECT (API 31+) or location permissions (API 30 and below).
 *
 * "blocked" means the user must change the setting in the OS Settings app;
 * re-requesting from the app will not show a prompt.
 */
export const BLE_PERMISSION_STATES = [
  'unknown',
  'not_requested',
  'granted',
  'denied',
  'blocked',
] as const;

export type BlePermissionState = (typeof BLE_PERMISSION_STATES)[number];
