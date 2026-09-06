import type { BleError, BlePermissionState, BluetoothState } from '@beacon/ble-contracts';
import type { BluetoothAdapterStatus } from '../adapter/bluetoothAdapterReducer';
import type { PermissionStatus } from '../permissions/permissionReducer';

/**
 * What the app can do with Bluetooth right now, derived from the adapter and
 * permission machines. This is the single input later milestones use to
 * decide whether scanning may start, and what guidance to show otherwise.
 */
export type BluetoothReadiness =
  | { kind: 'checking' }
  | { kind: 'failed'; error: BleError }
  | { kind: 'unsupported' }
  | { kind: 'permission_required'; permission: BlePermissionState }
  | { kind: 'permission_requesting' }
  | { kind: 'permission_blocked' }
  | { kind: 'powered_off' }
  | { kind: 'unavailable'; state: Extract<BluetoothState, 'unknown' | 'resetting'> }
  | { kind: 'ready' };

/**
 * Precedence, highest first:
 * 1. failure of either machine (the user must be able to retry);
 * 2. unsupported hardware (asking for permission would be pointless);
 * 3. anything still in flight;
 * 4. permission, because on iOS the adapter cannot report a real state until
 *    authorization is decided;
 * 5. adapter state.
 */
export function deriveBluetoothReadiness(
  adapter: BluetoothAdapterStatus,
  permission: PermissionStatus,
): BluetoothReadiness {
  if (adapter.phase === 'failed') {
    return { kind: 'failed', error: adapter.error };
  }
  if (permission.phase === 'failed') {
    return { kind: 'failed', error: permission.error };
  }
  if (adapter.phase === 'ready' && adapter.state === 'unsupported') {
    return { kind: 'unsupported' };
  }
  if (permission.phase === 'requesting') {
    // The system prompt is up; keep the permission guidance on screen (disabled)
    // instead of flashing back to "checking".
    return { kind: 'permission_requesting' };
  }
  if (adapter.phase === 'initializing' || permission.phase === 'checking') {
    return { kind: 'checking' };
  }

  switch (permission.state) {
    case 'granted':
      break;
    case 'blocked':
      return { kind: 'permission_blocked' };
    case 'not_requested':
    case 'denied':
    case 'unknown':
      return { kind: 'permission_required', permission: permission.state };
  }

  switch (adapter.state) {
    case 'powered_on':
      return { kind: 'ready' };
    case 'powered_off':
      return { kind: 'powered_off' };
    case 'unauthorized':
      return { kind: 'permission_blocked' };
    case 'unsupported':
      return { kind: 'unsupported' };
    case 'unknown':
    case 'resetting':
      return { kind: 'unavailable', state: adapter.state };
  }
}
