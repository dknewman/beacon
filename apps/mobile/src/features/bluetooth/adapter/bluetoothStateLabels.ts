import type { BluetoothState } from '@beacon/ble-contracts';

export interface BluetoothStateLabel {
  /** Short status text shown in the badge, e.g. "ON". */
  short: string;
  /** Sentence explaining the state and what the user can do about it. */
  description: string;
}

/**
 * Human readable labels for every adapter state. State is communicated with
 * text, never color alone (PROJECT.md 36).
 */
export function describeBluetoothState(state: BluetoothState): BluetoothStateLabel {
  switch (state) {
    case 'powered_on':
      return { short: 'On', description: 'Bluetooth is on and ready to scan.' };
    case 'powered_off':
      return {
        short: 'Off',
        description: 'Turn on Bluetooth in system settings to scan.',
      };
    case 'unauthorized':
      return {
        short: 'Not allowed',
        description: 'Beacon does not have permission to use Bluetooth.',
      };
    case 'unsupported':
      return {
        short: 'Unsupported',
        description: 'This device does not support Bluetooth LE.',
      };
    case 'resetting':
      return { short: 'Resetting', description: 'The Bluetooth system is restarting.' };
    case 'unknown':
      return {
        short: 'Unknown',
        description: 'Waiting for the Bluetooth adapter to report.',
      };
  }
}
