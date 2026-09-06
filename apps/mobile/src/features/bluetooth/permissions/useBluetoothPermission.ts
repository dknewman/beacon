import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { toBleError } from '@beacon/ble-contracts';
import { useBleClient } from '../../../native/BleClientContext';
import {
  initialPermissionStatus,
  permissionReducer,
  type PermissionStatus,
} from './permissionReducer';

export interface BluetoothPermissionHandle {
  status: PermissionStatus;
  /** Shows the system prompt (when the platform still allows one). */
  request: () => void;
  /** Leaves the failed phase and re-reads the permission state. */
  retry: () => void;
}

/**
 * Reads the Bluetooth permission on mount and again whenever the app returns
 * to the foreground, so a change made in the OS Settings app is picked up
 * without a restart. Results that arrive after unmount are ignored, and
 * foreground re-checks are skipped while a request is in flight.
 */
export function useBluetoothPermission(): BluetoothPermissionHandle {
  const client = useBleClient();
  const [status, dispatch] = useReducer(permissionReducer, initialPermissionStatus);
  const [attempt, setAttempt] = useState(0);
  const active = useRef(true);
  const requestInFlight = useRef(false);

  useEffect(() => {
    active.current = true;

    const check = () => {
      if (requestInFlight.current) {
        return;
      }
      client.getPermissionState().then(
        state => {
          if (active.current && !requestInFlight.current) {
            dispatch({ type: 'state_received', state });
          }
        },
        (error: unknown) => {
          if (active.current && !requestInFlight.current) {
            dispatch({
              type: 'request_failed',
              error: toBleError(error, 'native_failure'),
            });
          }
        },
      );
    };

    check();
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        check();
      }
    });

    return () => {
      active.current = false;
      subscription.remove();
    };
  }, [client, attempt]);

  const request = useCallback(() => {
    if (requestInFlight.current) {
      return;
    }
    requestInFlight.current = true;
    dispatch({ type: 'request_started' });
    client.requestPermission().then(
      state => {
        requestInFlight.current = false;
        if (active.current) {
          dispatch({ type: 'state_received', state });
        }
      },
      (error: unknown) => {
        requestInFlight.current = false;
        if (active.current) {
          dispatch({
            type: 'request_failed',
            error: toBleError(error, 'native_failure'),
          });
        }
      },
    );
  }, [client]);

  const retry = useCallback(() => {
    dispatch({ type: 'retry_requested' });
    setAttempt(current => current + 1);
  }, []);

  return { status, request, retry };
}
