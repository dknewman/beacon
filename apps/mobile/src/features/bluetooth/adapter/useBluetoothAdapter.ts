import { useCallback, useEffect, useReducer, useState } from 'react';
import { toBleError } from '@beacon/ble-contracts';
import { useBluetoothAdapterClient } from '../../../native/BleClientContext';
import {
  bluetoothAdapterReducer,
  initialBluetoothAdapterStatus,
  type BluetoothAdapterStatus,
} from './bluetoothAdapterReducer';

export interface BluetoothAdapterHandle {
  status: BluetoothAdapterStatus;
  retry: () => void;
}

/**
 * Subscribes to adapter state and fetches the initial value.
 *
 * Ordering matters: the event subscription is attached before the initial
 * read so a transition that happens during the read is not lost. Results that
 * arrive after unmount (or after a retry restarted the effect) are ignored.
 */
export function useBluetoothAdapter(): BluetoothAdapterHandle {
  const client = useBluetoothAdapterClient();
  const [status, dispatch] = useReducer(
    bluetoothAdapterReducer,
    initialBluetoothAdapterStatus,
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    const unsubscribe = client.subscribe(event => {
      if (!active) {
        return;
      }
      switch (event.type) {
        case 'bluetooth.state_changed':
          dispatch({ type: 'native_state_received', state: event.state });
          break;
        case 'ble.error':
          if (event.deviceId === undefined) {
            dispatch({ type: 'native_failed', error: toBleError(event.error) });
          }
          break;
        default:
          // Device-scoped events are handled by later milestones' coordinators.
          break;
      }
    });

    client.getBluetoothState().then(
      state => {
        if (active) {
          dispatch({ type: 'native_state_received', state });
        }
      },
      (error: unknown) => {
        if (active) {
          dispatch({ type: 'native_failed', error: toBleError(error, 'native_failure') });
        }
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [client, attempt]);

  const retry = useCallback(() => {
    dispatch({ type: 'retry_requested' });
    setAttempt(current => current + 1);
  }, []);

  return { status, retry };
}
