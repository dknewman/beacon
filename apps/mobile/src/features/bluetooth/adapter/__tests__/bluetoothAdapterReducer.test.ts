import { BleError } from '@beacon/ble-contracts';
import {
  bluetoothAdapterReducer,
  initialBluetoothAdapterStatus,
} from '../bluetoothAdapterReducer';

const error = new BleError({ code: 'native_failure', message: 'boom' });

describe('bluetoothAdapterReducer', () => {
  it('starts initializing', () => {
    expect(initialBluetoothAdapterStatus).toEqual({ phase: 'initializing' });
  });

  it('becomes ready when native reports a state', () => {
    expect(
      bluetoothAdapterReducer(initialBluetoothAdapterStatus, {
        type: 'native_state_received',
        state: 'powered_on',
      }),
    ).toEqual({ phase: 'ready', state: 'powered_on' });
  });

  it('replaces the state on subsequent reports', () => {
    const ready = bluetoothAdapterReducer(initialBluetoothAdapterStatus, {
      type: 'native_state_received',
      state: 'powered_on',
    });
    expect(
      bluetoothAdapterReducer(ready, {
        type: 'native_state_received',
        state: 'powered_off',
      }),
    ).toEqual({ phase: 'ready', state: 'powered_off' });
  });

  it('fails from any phase', () => {
    const ready = bluetoothAdapterReducer(initialBluetoothAdapterStatus, {
      type: 'native_state_received',
      state: 'powered_on',
    });
    expect(bluetoothAdapterReducer(ready, { type: 'native_failed', error })).toEqual({
      phase: 'failed',
      error,
    });
  });

  it('recovers from failure after a native state arrives', () => {
    const failed = bluetoothAdapterReducer(initialBluetoothAdapterStatus, {
      type: 'native_failed',
      error,
    });
    expect(
      bluetoothAdapterReducer(failed, {
        type: 'native_state_received',
        state: 'powered_on',
      }),
    ).toEqual({ phase: 'ready', state: 'powered_on' });
  });

  it('only retries from the failed phase', () => {
    const failed = bluetoothAdapterReducer(initialBluetoothAdapterStatus, {
      type: 'native_failed',
      error,
    });
    expect(bluetoothAdapterReducer(failed, { type: 'retry_requested' })).toEqual({
      phase: 'initializing',
    });
    const ready = bluetoothAdapterReducer(initialBluetoothAdapterStatus, {
      type: 'native_state_received',
      state: 'powered_on',
    });
    expect(bluetoothAdapterReducer(ready, { type: 'retry_requested' })).toBe(ready);
  });
});
