import {
  toBleError,
  type BluetoothAdapterApi,
  type BluetoothState,
  type NativeBleEvent,
  type Unsubscribe,
} from '@beacon/ble-contracts';
import { parseBluetoothState, parseNativeBleEvent } from '@beacon/validation';
import type { Spec } from './specs/NativeBeaconBluetooth';

/**
 * Wraps the raw Turbo Module in the typed BluetoothAdapterApi contract.
 *
 * Responsibilities:
 * - Validate every value that crosses the bridge before it reaches app state.
 * - Convert native promise rejections into BleError.
 * - Fold per-event native emitters into the single NativeBleEvent stream and
 *   surface malformed payloads as "ble.error" events rather than dropping them.
 *
 * It holds no BLE state of its own: native remains the source of truth.
 */
export function createNativeBluetoothAdapterClient(spec: Spec): BluetoothAdapterApi {
  return {
    async getBluetoothState(): Promise<BluetoothState> {
      let raw: string;
      try {
        raw = await spec.getBluetoothState();
      } catch (error) {
        throw toBleError(error, 'native_failure');
      }
      const result = parseBluetoothState(raw);
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
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
