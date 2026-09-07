import type { BleError, ConnectionState } from '@beacon/ble-contracts';

/**
 * Application-side mirror of one device's connection (PROJECT.md 14).
 *
 * `state` is exactly what native last reported, with two JavaScript-owned
 * exceptions: `connecting` is entered optimistically when the user asks
 * (native confirms with its own `connecting`), and `failed` may be entered from
 * a JavaScript timeout or a rejected call before native reports the resulting
 * `disconnected`. `lastError` survives the `failed -> disconnected` transition
 * so the detail screen can say why the link ended.
 */
export interface DeviceConnection {
  state: ConnectionState;
  lastError?: BleError;
  /** Epoch milliseconds when `state` was entered. */
  since: number;
}

export type ConnectionsState = Readonly<Record<string, DeviceConnection>>;

export type ConnectionAction =
  | { type: 'connect_requested'; deviceId: string; at: number }
  | { type: 'disconnect_requested'; deviceId: string; at: number }
  | {
      type: 'native_state_received';
      deviceId: string;
      state: ConnectionState;
      at: number;
    }
  | { type: 'native_error_received'; deviceId: string; error: BleError; at: number }
  /** A connect/disconnect call rejected, or the JavaScript connect timeout fired. */
  | { type: 'request_failed'; deviceId: string; error: BleError; at: number };

/** Codes that describe one GATT operation rather than the link; they never move the machine. */
const OPERATION_ERROR_CODES: ReadonlySet<string> = new Set([
  'read_failed',
  'write_failed',
  'subscription_failed',
]);

export const initialConnectionsState: ConnectionsState = {};

export const disconnectedConnection: DeviceConnection = {
  state: 'disconnected',
  since: 0,
};

export function connectionOf(
  connections: ConnectionsState,
  deviceId: string,
): DeviceConnection {
  return connections[deviceId] ?? disconnectedConnection;
}

export function connectionsReducer(
  connections: ConnectionsState,
  action: ConnectionAction,
): ConnectionsState {
  const current = connectionOf(connections, action.deviceId);
  const next = reduceOne(current, action);
  return next === current ? connections : { ...connections, [action.deviceId]: next };
}

function reduceOne(
  current: DeviceConnection,
  action: ConnectionAction,
): DeviceConnection {
  switch (action.type) {
    case 'connect_requested':
      return current.state === 'disconnected' || current.state === 'failed'
        ? { state: 'connecting', since: action.at }
        : current;

    case 'disconnect_requested':
      return current.state === 'disconnected' ||
        current.state === 'disconnecting' ||
        current.state === 'failed'
        ? current
        : { ...current, state: 'disconnecting', since: action.at };

    case 'native_state_received':
      if (action.state === current.state) {
        return current;
      }
      if (action.state === 'disconnected') {
        // Native always reports the error before the disconnect it caused, so a
        // `failed` state here carries the reason; a clean disconnect has none.
        return current.state === 'failed' && current.lastError !== undefined
          ? { state: 'disconnected', lastError: current.lastError, since: action.at }
          : { state: 'disconnected', since: action.at };
      }
      return { state: action.state, since: action.at };

    case 'native_error_received':
      if (OPERATION_ERROR_CODES.has(action.error.code)) {
        // A read, write or subscription failed; the link itself is intact and the
        // operation's own promise or the subscription state carries the reason.
        return current;
      }
      return current.state === 'disconnected'
        ? { ...current, lastError: action.error }
        : { state: 'failed', lastError: action.error, since: action.at };

    case 'request_failed':
      return current.state === 'disconnected'
        ? { ...current, lastError: action.error }
        : { state: 'failed', lastError: action.error, since: action.at };
  }
}
