import type { BluetoothState } from './bluetooth-state';
import type { GattService } from './gatt';
import type { NativeBleEvent } from './native-events';

/**
 * Typed contract implemented by the native bridge wrapper and by MockBleClient.
 *
 * The interface is split by responsibility so each milestone can ship a
 * complete, honest implementation of one segment without stubbing the rest.
 * `NativeBleClient` is the full union used once every segment exists.
 *
 * Rules (PROJECT.md 25, 29):
 * - Native state is authoritative; JS never infers connection state locally.
 * - Every method rejects with a BleError (see errors.ts), never a raw string.
 * - Every subscription returns an unsubscribe function and must be cleaned up.
 */

export type Unsubscribe = () => void;

export interface BleEventSource {
  /** Subscribe to validated native events. Invalid payloads surface as "ble.error". */
  subscribe(listener: (event: NativeBleEvent) => void): Unsubscribe;
}

export interface BluetoothAdapterApi extends BleEventSource {
  getBluetoothState(): Promise<BluetoothState>;
}

export interface ScanOptions {
  /** Restrict discovery to peripherals advertising any of these service UUIDs. */
  serviceUuids?: string[];
  /** Report every advertisement rather than deduplicating natively (Android only honors this partially). */
  allowDuplicates?: boolean;
}

export interface ScanApi {
  startScan(options?: ScanOptions): Promise<void>;
  stopScan(): Promise<void>;
}

export interface ConnectionApi {
  connect(deviceId: string): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  readRssi(deviceId: string): Promise<number>;
}

export type WriteMode = 'with_response' | 'without_response';

export interface WriteCharacteristicRequest {
  deviceId: string;
  serviceUuid: string;
  characteristicUuid: string;
  bytes: number[];
  mode: WriteMode;
}

export interface NotificationRequest {
  deviceId: string;
  serviceUuid: string;
  characteristicUuid: string;
  enabled: boolean;
}

export interface GattApi {
  discoverServices(deviceId: string): Promise<GattService[]>;
  readCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<number[]>;
  writeCharacteristic(request: WriteCharacteristicRequest): Promise<void>;
  setNotify(request: NotificationRequest): Promise<void>;
}

export interface NativeBleClient
  extends BluetoothAdapterApi, ScanApi, ConnectionApi, GattApi {}
