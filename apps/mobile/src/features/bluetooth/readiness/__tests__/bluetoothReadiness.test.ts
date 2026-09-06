import { BleError, type BluetoothState } from '@beacon/ble-contracts';
import type { BluetoothAdapterStatus } from '../../adapter/bluetoothAdapterReducer';
import type { PermissionStatus } from '../../permissions/permissionReducer';
import { deriveBluetoothReadiness } from '../bluetoothReadiness';

const error = new BleError({ code: 'native_failure', message: 'boom' });
const adapter = (state: BluetoothState): BluetoothAdapterStatus => ({
  phase: 'ready',
  state,
});
const granted: PermissionStatus = { phase: 'ready', state: 'granted' };

describe('deriveBluetoothReadiness', () => {
  it('reports failure from either machine first', () => {
    expect(deriveBluetoothReadiness({ phase: 'failed', error }, granted)).toEqual({
      kind: 'failed',
      error,
    });
    expect(
      deriveBluetoothReadiness(adapter('powered_on'), { phase: 'failed', error }),
    ).toEqual({
      kind: 'failed',
      error,
    });
  });

  it('reports unsupported hardware before asking for permission', () => {
    expect(
      deriveBluetoothReadiness(adapter('unsupported'), {
        phase: 'ready',
        state: 'not_requested',
      }),
    ).toEqual({ kind: 'unsupported' });
  });

  it('is checking while either machine is in flight', () => {
    expect(deriveBluetoothReadiness({ phase: 'initializing' }, granted)).toEqual({
      kind: 'checking',
    });
    expect(
      deriveBluetoothReadiness(adapter('powered_on'), { phase: 'checking' }),
    ).toEqual({
      kind: 'checking',
    });
  });

  it('keeps permission guidance on screen while the prompt is up', () => {
    expect(
      deriveBluetoothReadiness(adapter('powered_on'), { phase: 'requesting' }),
    ).toEqual({ kind: 'permission_requesting' });
    // Even before the adapter has reported, since iOS defers that until the answer.
    expect(
      deriveBluetoothReadiness({ phase: 'initializing' }, { phase: 'requesting' }),
    ).toEqual({ kind: 'permission_requesting' });
  });

  it('asks for permission before looking at adapter state', () => {
    // On iOS the adapter reports "unknown" until authorization is decided.
    expect(
      deriveBluetoothReadiness(adapter('unknown'), {
        phase: 'ready',
        state: 'not_requested',
      }),
    ).toEqual({ kind: 'permission_required', permission: 'not_requested' });
    expect(
      deriveBluetoothReadiness(adapter('powered_on'), {
        phase: 'ready',
        state: 'denied',
      }),
    ).toEqual({ kind: 'permission_required', permission: 'denied' });
    expect(
      deriveBluetoothReadiness(adapter('powered_on'), {
        phase: 'ready',
        state: 'blocked',
      }),
    ).toEqual({ kind: 'permission_blocked' });
  });

  it('maps adapter states once permission is granted', () => {
    expect(deriveBluetoothReadiness(adapter('powered_on'), granted)).toEqual({
      kind: 'ready',
    });
    expect(deriveBluetoothReadiness(adapter('powered_off'), granted)).toEqual({
      kind: 'powered_off',
    });
    expect(deriveBluetoothReadiness(adapter('unauthorized'), granted)).toEqual({
      kind: 'permission_blocked',
    });
    expect(deriveBluetoothReadiness(adapter('resetting'), granted)).toEqual({
      kind: 'unavailable',
      state: 'resetting',
    });
    expect(deriveBluetoothReadiness(adapter('unknown'), granted)).toEqual({
      kind: 'unavailable',
      state: 'unknown',
    });
  });
});
