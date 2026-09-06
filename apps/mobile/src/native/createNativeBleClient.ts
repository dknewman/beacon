import {
  toBleError,
  type BlePermissionState,
  type BluetoothState,
  type NativeBleEvent,
  type Unsubscribe,
} from '@beacon/ble-contracts';
import {
  parseBlePermissionState,
  parseBluetoothState,
  parseNativeBleEvent,
  type ValidationResult,
} from '@beacon/validation';
import type { BleClient } from './BleClient';
import type { Spec } from './specs/NativeBeaconBluetooth';

/**
 * Wraps the raw Turbo Module in the typed BleClient contract.
 *
 * Responsibilities:
 * - Validate every value that crosses the bridge before it reaches app state.
 * - Convert native promise rejections into BleError.
 * - Fold per-event native emitters into the single NativeBleEvent stream and
 *   surface malformed payloads as "ble.error" events rather than dropping them.
 *
 * It holds no BLE state of its own: native remains the source of truth.
 */
export function createNativeBleClient(spec: Spec): BleClient {
  return {
    getBluetoothState(): Promise<BluetoothState> {
      return callValidated(() => spec.getBluetoothState(), parseBluetoothState);
    },

    getPermissionState(): Promise<BlePermissionState> {
      return callValidated(() => spec.getPermissionState(), parseBlePermissionState);
    },

    requestPermission(): Promise<BlePermissionState> {
      return callValidated(() => spec.requestPermission(), parseBlePermissionState);
    },

    subscribe(listener: (event: NativeBleEvent) => void): Unsubscribe {
      const subscription = spec.onBluetoothStateChanged(payload => {
        const result = parseNativeBleEvent({
          type: 'bluetooth.state_changed',
          state: payload.state,
        });
        listener(
          result.ok ? result.value : { type: 'ble.error', error: result.error.toInfo() },
        );
      });
      return () => {
        subscription.remove();
      };
    },
  };
}

/**
 * Awaits a native call, maps rejections to BleError (defaulting to native_failure),
 * and validates the resolved value; invalid values reject with invalid_payload.
 */
async function callValidated<TRaw, TValue>(
  call: () => Promise<TRaw>,
  parse: (raw: unknown) => ValidationResult<TValue, Error>,
): Promise<TValue> {
  let raw: TRaw;
  try {
    raw = await call();
  } catch (error) {
    throw toBleError(error, 'native_failure');
  }
  const result = parse(raw);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}
