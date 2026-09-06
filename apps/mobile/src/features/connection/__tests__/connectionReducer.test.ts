import { BleError } from '@beacon/ble-contracts';
import {
  connectionOf,
  connectionsReducer,
  initialConnectionsState,
  type ConnectionsState,
} from '../connectionReducer';

const id = 'dev-1';
const error = new BleError({ code: 'connection_failed', message: 'Peer refused' });

function apply(actions: Parameters<typeof connectionsReducer>[1][]): ConnectionsState {
  return actions.reduce(connectionsReducer, initialConnectionsState);
}

describe('connectionsReducer', () => {
  it('treats unknown devices as disconnected', () => {
    expect(connectionOf(initialConnectionsState, id)).toEqual({
      state: 'disconnected',
      since: 0,
    });
  });

  it('follows the native happy path after an optimistic connecting', () => {
    const state = apply([
      { type: 'connect_requested', deviceId: id, at: 1 },
      { type: 'native_state_received', deviceId: id, state: 'connecting', at: 2 },
      { type: 'native_state_received', deviceId: id, state: 'connected', at: 3 },
      {
        type: 'native_state_received',
        deviceId: id,
        state: 'discovering_services',
        at: 4,
      },
      { type: 'native_state_received', deviceId: id, state: 'ready', at: 5 },
    ]);
    expect(connectionOf(state, id)).toEqual({ state: 'ready', since: 5 });
  });

  it('keeps the error across failed → disconnected, and clears it on the next attempt', () => {
    let state = apply([
      { type: 'connect_requested', deviceId: id, at: 1 },
      { type: 'native_error_received', deviceId: id, error, at: 2 },
    ]);
    expect(connectionOf(state, id)).toEqual({
      state: 'failed',
      lastError: error,
      since: 2,
    });

    state = connectionsReducer(state, {
      type: 'native_state_received',
      deviceId: id,
      state: 'disconnected',
      at: 3,
    });
    expect(connectionOf(state, id)).toEqual({
      state: 'disconnected',
      lastError: error,
      since: 3,
    });

    state = connectionsReducer(state, { type: 'connect_requested', deviceId: id, at: 4 });
    expect(connectionOf(state, id)).toEqual({ state: 'connecting', since: 4 });
  });

  it('records a clean disconnect without an error', () => {
    const state = apply([
      { type: 'connect_requested', deviceId: id, at: 1 },
      { type: 'native_state_received', deviceId: id, state: 'ready', at: 2 },
      { type: 'disconnect_requested', deviceId: id, at: 3 },
      { type: 'native_state_received', deviceId: id, state: 'disconnected', at: 4 },
    ]);
    expect(connectionOf(state, id)).toEqual({ state: 'disconnected', since: 4 });
  });

  it('records a rejected request or timeout as failed', () => {
    const timeout = new BleError({ code: 'connection_timeout', message: 'No answer' });
    const state = apply([
      { type: 'connect_requested', deviceId: id, at: 1 },
      { type: 'request_failed', deviceId: id, error: timeout, at: 2 },
    ]);
    expect(connectionOf(state, id)).toEqual({
      state: 'failed',
      lastError: timeout,
      since: 2,
    });
  });

  it('keeps disconnected when an error or rejection arrives after native already disconnected', () => {
    const state = apply([
      { type: 'connect_requested', deviceId: id, at: 1 },
      { type: 'native_state_received', deviceId: id, state: 'disconnected', at: 2 },
      { type: 'request_failed', deviceId: id, error, at: 3 },
    ]);
    expect(connectionOf(state, id)).toEqual({
      state: 'disconnected',
      lastError: error,
      since: 2,
    });
  });

  it('ignores requests that do not apply and returns the same object', () => {
    const ready = apply([
      { type: 'connect_requested', deviceId: id, at: 1 },
      { type: 'native_state_received', deviceId: id, state: 'ready', at: 2 },
    ]);
    expect(
      connectionsReducer(ready, { type: 'connect_requested', deviceId: id, at: 3 }),
    ).toBe(ready);
    expect(
      connectionsReducer(initialConnectionsState, {
        type: 'disconnect_requested',
        deviceId: id,
        at: 3,
      }),
    ).toBe(initialConnectionsState);
    expect(
      connectionsReducer(ready, {
        type: 'native_state_received',
        deviceId: id,
        state: 'ready',
        at: 9,
      }),
    ).toBe(ready);
  });

  it('keeps devices independent', () => {
    const state = apply([
      { type: 'connect_requested', deviceId: 'a', at: 1 },
      { type: 'connect_requested', deviceId: 'b', at: 1 },
      { type: 'native_error_received', deviceId: 'b', error, at: 2 },
    ]);
    expect(connectionOf(state, 'a').state).toBe('connecting');
    expect(connectionOf(state, 'b').state).toBe('failed');
  });
});
