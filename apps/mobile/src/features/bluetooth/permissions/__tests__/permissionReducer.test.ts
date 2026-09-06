import { BleError } from '@beacon/ble-contracts';
import { initialPermissionStatus, permissionReducer } from '../permissionReducer';

const error = new BleError({ code: 'native_failure', message: 'no activity' });

describe('permissionReducer', () => {
  it('starts checking', () => {
    expect(initialPermissionStatus).toEqual({ phase: 'checking' });
  });

  it('becomes ready when a state arrives', () => {
    expect(
      permissionReducer(initialPermissionStatus, {
        type: 'state_received',
        state: 'denied',
      }),
    ).toEqual({ phase: 'ready', state: 'denied' });
  });

  it('enters requesting once and stays there on duplicate starts', () => {
    const requesting = permissionReducer(initialPermissionStatus, {
      type: 'request_started',
    });
    expect(requesting).toEqual({ phase: 'requesting' });
    expect(permissionReducer(requesting, { type: 'request_started' })).toBe(requesting);
  });

  it('resolves a request with the resulting state', () => {
    const requesting = permissionReducer(initialPermissionStatus, {
      type: 'request_started',
    });
    expect(
      permissionReducer(requesting, { type: 'state_received', state: 'granted' }),
    ).toEqual({
      phase: 'ready',
      state: 'granted',
    });
  });

  it('fails from any phase and only retries from failed', () => {
    const failed = permissionReducer(initialPermissionStatus, {
      type: 'request_failed',
      error,
    });
    expect(failed).toEqual({ phase: 'failed', error });
    expect(permissionReducer(failed, { type: 'retry_requested' })).toEqual({
      phase: 'checking',
    });

    const ready = permissionReducer(initialPermissionStatus, {
      type: 'state_received',
      state: 'granted',
    });
    expect(permissionReducer(ready, { type: 'retry_requested' })).toBe(ready);
  });
});
