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
import { toBleError } from '@beacon/ble-contracts';
import { useBleClient } from '../../native/BleClientContext';
import { useConnections } from '../connection/ConnectionProvider';
import {
  gattReducer,
  gattStatusOf,
  initialGattState,
  type GattStatus,
} from './gattReducer';

export interface GattCoordinator {
  statusOf: (deviceId: string) => GattStatus;
  /** Fetches the table for a ready device; a no-op while a fetch is in flight. */
  discover: (deviceId: string) => void;
}

const GattContext = createContext<GattCoordinator | undefined>(undefined);

/**
 * Holds each device's GATT table above navigation so the detail screen, the
 * inspector and the characteristic screen share one copy. The table is tied
 * to the link: when the connection coordinator reports the device left
 * `ready`, the table is dropped and the next visit discovers it again.
 */
export function GattProvider({ children }: PropsWithChildren): React.JSX.Element {
  const client = useBleClient();
  const { connections } = useConnections();
  const [state, dispatch] = useReducer(gattReducer, initialGattState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    for (const deviceId of Object.keys(stateRef.current)) {
      if (connections[deviceId]?.state !== 'ready') {
        dispatch({ type: 'link_ended', deviceId });
      }
    }
  }, [connections]);

  const discover = useCallback(
    (deviceId: string) => {
      if (gattStatusOf(stateRef.current, deviceId).phase === 'discovering') {
        return;
      }
      dispatch({ type: 'discovery_requested', deviceId });
      client.discoverServices(deviceId).then(
        services => dispatch({ type: 'discovery_succeeded', deviceId, services }),
        (error: unknown) =>
          dispatch({
            type: 'discovery_failed',
            deviceId,
            error: toBleError(error, 'service_not_found'),
          }),
      );
    },
    [client],
  );

  const value = useMemo<GattCoordinator>(
    () => ({ statusOf: deviceId => gattStatusOf(state, deviceId), discover }),
    [state, discover],
  );

  return <GattContext.Provider value={value}>{children}</GattContext.Provider>;
}

export function useGatt(): GattCoordinator {
  const value = useContext(GattContext);
  if (value === undefined) {
    throw new Error('useGatt must be used within a GattProvider');
  }
  return value;
}
