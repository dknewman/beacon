import {
  toBleError,
  type BlePermissionState,
  type BluetoothState,
  type GattService,
  type NativeBleEvent,
  type ScanOptions,
  type Unsubscribe,
  type WriteCharacteristicRequest,
} from '@beacon/ble-contracts';
import {
  parseBlePermissionState,
  parseBluetoothState,
  parseByteArray,
  parseGattServices,
  parseNativeBleEvent,
  parseRssi,
  type ValidationResult,
} from '@beacon/validation';
import type { EventSubscription } from 'react-native';
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

    startScan(options?: ScanOptions): Promise<void> {
      return callVoid(() =>
        spec.startScan(options?.serviceUuids ?? [], options?.allowDuplicates ?? false),
      );
    },

    stopScan(): Promise<void> {
      return callVoid(() => spec.stopScan());
    },

    connect(deviceId: string): Promise<void> {
      return callVoid(() => spec.connect(deviceId), 'connection_failed');
    },

    disconnect(deviceId: string): Promise<void> {
      return callVoid(() => spec.disconnect(deviceId));
    },

    readRssi(deviceId: string): Promise<number> {
      return callValidated(() => spec.readRssi(deviceId), parseRssi);
    },

    discoverServices(deviceId: string): Promise<GattService[]> {
      return callValidated(() => spec.discoverServices(deviceId), parseGattServices);
    },

    readCharacteristic(
      deviceId: string,
      serviceUuid: string,
      characteristicUuid: string,
    ): Promise<number[]> {
      return callValidated(
        () => spec.readCharacteristic(deviceId, serviceUuid, characteristicUuid),
        parseByteArray,
        'read_failed',
      );
    },

    writeCharacteristic(request: WriteCharacteristicRequest): Promise<void> {
      return callVoid(
        () =>
          spec.writeCharacteristic(
            request.deviceId,
            request.serviceUuid,
            request.characteristicUuid,
            request.bytes,
            request.mode === 'with_response',
          ),
        'write_failed',
      );
    },

    subscribe(listener: (event: NativeBleEvent) => void): Unsubscribe {
      const deliver = (candidate: unknown) => {
        const result = parseNativeBleEvent(candidate);
        listener(
          result.ok ? result.value : { type: 'ble.error', error: result.error.toInfo() },
        );
      };
      const subscriptions: EventSubscription[] = [
        spec.onBluetoothStateChanged(payload => {
          deliver({ type: 'bluetooth.state_changed', state: payload.state });
        }),
        spec.onDeviceDiscovered(payload => {
          deliver({ type: 'scan.device_discovered', device: payload });
        }),
        spec.onConnectionStateChanged(payload => {
          deliver({
            type: 'connection.state_changed',
            deviceId: payload.deviceId,
            state: payload.state,
          });
        }),
        spec.onBleError(payload => {
          deliver({
            type: 'ble.error',
            deviceId: payload.deviceId,
            error: payload.error,
          });
        }),
      ];
      return () => {
        subscriptions.forEach(subscription => subscription.remove());
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
  fallback: Parameters<typeof toBleError>[1] = 'native_failure',
): Promise<TValue> {
  let raw: TRaw;
  try {
    raw = await call();
  } catch (error) {
    throw toBleError(error, fallback);
  }
  const result = parse(raw);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/** Awaits a native call that carries no result, mapping rejections to BleError. */
async function callVoid(
  call: () => Promise<void>,
  fallback: Parameters<typeof toBleError>[1] = 'native_failure',
): Promise<void> {
  try {
    await call();
  } catch (error) {
    throw toBleError(error, fallback);
  }
}
