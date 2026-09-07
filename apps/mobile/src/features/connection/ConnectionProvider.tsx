import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type PropsWithChildren,
} from 'react';
import { BleError, toBleError } from '@beacon/ble-contracts';
import { useBleClient } from '../../native/BleClientContext';
import { useActivityBus } from '../activity/ActivityBusProvider';
import {
  connectionOf,
  connectionsReducer,
  initialConnectionsState,
  type ConnectionsState,
  type DeviceConnection,
} from './connectionReducer';

export interface ConnectionCoordinator {
  connections: ConnectionsState;
  connectionOf: (deviceId: string) => DeviceConnection;
  /** Starts a connection attempt; no-op unless the device is disconnected or failed. */
  connect: (deviceId: string) => void;
  /** Disconnects, or cancels an attempt in progress. */
  disconnect: (deviceId: string) => void;
  /** Reads live RSSI; rejects with `disconnected` when there is no link. */
  readRssi: (deviceId: string) => Promise<number>;
}

export interface ConnectionProviderProps {
  /** How long a connection attempt may take before it is cancelled and marked failed. */
  connectTimeoutMs?: number;
}

/**
 * CoreBluetooth never times out a connection attempt on its own and Android
 * takes about 30 s; 15 s is long enough for a sleepy peripheral and short
 * enough that the screen does not look stuck.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

const ConnectionContext = createContext<ConnectionCoordinator | undefined>(undefined);

/**
 * The Connection Coordinator (PROJECT.md 6, 13, 14, 29). Lives above navigation
 * so a link survives moving between the list and the detail screen.
 *
 * Rules:
 * - Native state is authoritative: every `connection.state_changed` event lands
 *   in the reducer as-is. JavaScript only adds the optimistic `connecting`, the
 *   timeout, and the memory of why a link ended.
 * - One attempt per device: `connect` is ignored unless the device is
 *   disconnected or failed, and the reducer enforces the same rule.
 * - A timeout cancels the native attempt through `disconnect`, so native never
 *   keeps trying while the UI shows failed.
 * - Device-scoped `ble.error` events (connection failure, remote disconnect)
 *   move that device to `failed`; the `disconnected` state native sends next
 *   keeps the error as `lastError`.
 * - Every native state change, device error and RSSI reading is published on
 *   the activity bus so a running session records it.
 */
export function ConnectionProvider({
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  children,
}: PropsWithChildren<ConnectionProviderProps>): React.JSX.Element {
  const client = useBleClient();
  const bus = useActivityBus();
  const [connections, dispatch] = useReducer(connectionsReducer, initialConnectionsState);
  const timeouts = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Attempts JavaScript ended (cancel, timeout): their rejection is expected, not an error. */
  const cancelledAttempts = useRef(new Set<string>());

  const clearTimeoutFor = useCallback((deviceId: string) => {
    const handle = timeouts.current.get(deviceId);
    if (handle !== undefined) {
      clearTimeout(handle);
      timeouts.current.delete(deviceId);
    }
  }, []);

  const publishError = useCallback(
    (deviceId: string, error: BleError) => {
      bus.publish({
        deviceId,
        kind: 'error',
        error: error.toInfo(),
        timestamp: new Date().toISOString(),
      });
    },
    [bus],
  );

  useEffect(() => {
    const unsubscribe = client.subscribe(event => {
      switch (event.type) {
        case 'connection.state_changed':
          if (event.state !== 'connecting') {
            clearTimeoutFor(event.deviceId);
          }
          dispatch({
            type: 'native_state_received',
            deviceId: event.deviceId,
            state: event.state,
            at: Date.now(),
          });
          bus.publish({
            deviceId: event.deviceId,
            kind: 'connection',
            state: event.state,
            timestamp: new Date().toISOString(),
          });
          break;
        case 'ble.error':
          if (event.deviceId !== undefined) {
            clearTimeoutFor(event.deviceId);
            const error = toBleError(event.error);
            dispatch({
              type: 'native_error_received',
              deviceId: event.deviceId,
              error,
              at: Date.now(),
            });
            publishError(event.deviceId, error);
          }
          break;
        default:
          break;
      }
    });
    const pending = timeouts.current;
    return () => {
      unsubscribe();
      pending.forEach(handle => clearTimeout(handle));
      pending.clear();
    };
  }, [bus, client, clearTimeoutFor, publishError]);

  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;

  const connect = useCallback(
    (deviceId: string) => {
      const current = connectionOf(connectionsRef.current, deviceId);
      if (current.state !== 'disconnected' && current.state !== 'failed') {
        return;
      }
      dispatch({ type: 'connect_requested', deviceId, at: Date.now() });

      clearTimeoutFor(deviceId);
      timeouts.current.set(
        deviceId,
        setTimeout(() => {
          timeouts.current.delete(deviceId);
          cancelledAttempts.current.add(deviceId);
          const error = new BleError({
            code: 'connection_timeout',
            message: `No connection after ${Math.round(connectTimeoutMs / 1000)} s`,
          });
          dispatch({ type: 'request_failed', deviceId, error, at: Date.now() });
          publishError(deviceId, error);
          client.disconnect(deviceId).catch(() => undefined);
        }, connectTimeoutMs),
      );

      cancelledAttempts.current.delete(deviceId);
      client.connect(deviceId).then(
        () => {
          clearTimeoutFor(deviceId);
          cancelledAttempts.current.delete(deviceId);
        },
        (error: unknown) => {
          clearTimeoutFor(deviceId);
          if (cancelledAttempts.current.delete(deviceId)) {
            // JavaScript ended this attempt itself; the reducer already knows why.
            return;
          }
          const failure = toBleError(error, 'connection_failed');
          dispatch({ type: 'request_failed', deviceId, error: failure, at: Date.now() });
          publishError(deviceId, failure);
        },
      );
    },
    [client, clearTimeoutFor, connectTimeoutMs, publishError],
  );

  const disconnect = useCallback(
    (deviceId: string) => {
      clearTimeoutFor(deviceId);
      if (connectionOf(connectionsRef.current, deviceId).state === 'connecting') {
        cancelledAttempts.current.add(deviceId);
      }
      dispatch({ type: 'disconnect_requested', deviceId, at: Date.now() });
      client.disconnect(deviceId).catch((error: unknown) => {
        const failure = toBleError(error, 'native_failure');
        dispatch({ type: 'request_failed', deviceId, error: failure, at: Date.now() });
        publishError(deviceId, failure);
      });
    },
    [client, clearTimeoutFor, publishError],
  );

  const readRssi = useCallback(
    (deviceId: string) =>
      client.readRssi(deviceId).then(rssi => {
        bus.publish({
          deviceId,
          kind: 'rssi',
          rssi,
          timestamp: new Date().toISOString(),
        });
        return rssi;
      }),
    [bus, client],
  );

  const value = useMemo<ConnectionCoordinator>(
    () => ({
      connections,
      connectionOf: deviceId => connectionOf(connections, deviceId),
      connect,
      disconnect,
      readRssi,
    }),
    [connections, connect, disconnect, readRssi],
  );

  return (
    <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
  );
}

export function useConnections(): ConnectionCoordinator {
  const value = useContext(ConnectionContext);
  if (value === undefined) {
    throw new Error('useConnections must be used within a ConnectionProvider');
  }
  return value;
}

/** Convenience for screens that care about one device. */
export function useConnection(deviceId: string): DeviceConnection {
  return useConnections().connectionOf(deviceId);
}
