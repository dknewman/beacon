import type { BleError, BluetoothState } from '@beacon/ble-contracts';

/**
 * Explicit adapter state for the UI layer. Mirrors native adapter state; it
 * never infers "on/off" from booleans (PROJECT.md 3.3).
 */
export type BluetoothAdapterStatus =
  | { phase: 'initializing' }
  | { phase: 'ready'; state: BluetoothState }
  | { phase: 'failed'; error: BleError };

export type BluetoothAdapterAction =
  | { type: 'native_state_received'; state: BluetoothState }
  | { type: 'native_failed'; error: BleError }
  | { type: 'retry_requested' };

export const initialBluetoothAdapterStatus: BluetoothAdapterStatus = {
  phase: 'initializing',
};

export function bluetoothAdapterReducer(
  status: BluetoothAdapterStatus,
  action: BluetoothAdapterAction,
): BluetoothAdapterStatus {
  switch (action.type) {
    case 'native_state_received':
      return { phase: 'ready', state: action.state };
    case 'native_failed':
      return { phase: 'failed', error: action.error };
    case 'retry_requested':
      return status.phase === 'failed' ? initialBluetoothAdapterStatus : status;
  }
}
