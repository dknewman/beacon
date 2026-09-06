import type { BlePermissionState } from '@beacon/ble-contracts';

export interface PermissionStateLabel {
  short: string;
  description: string;
}

/** Text labels for every permission state; never communicated by color alone. */
export function describePermissionState(state: BlePermissionState): PermissionStateLabel {
  switch (state) {
    case 'granted':
      return {
        short: 'Granted',
        description: 'Beacon may scan for and connect to devices.',
      };
    case 'not_requested':
      return {
        short: 'Not asked yet',
        description: 'Beacon has not asked for Bluetooth access.',
      };
    case 'denied':
      return { short: 'Denied', description: 'Access was declined. You can ask again.' };
    case 'blocked':
      return {
        short: 'Blocked',
        description: 'Access must be enabled for Beacon in system settings.',
      };
    case 'unknown':
      return {
        short: 'Unknown',
        description: 'Permission state has not been determined.',
      };
  }
}
