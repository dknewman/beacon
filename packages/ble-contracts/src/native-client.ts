import type { BluetoothState } from './bluetooth-state';
import type { GattService } from './gatt';
import type { NativeBleEvent } from './native-events';
import type { BlePermissionState } from './permissions';

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

/**
 * Runtime permission to use Bluetooth.
 *
 * Platform notes:
 * - iOS reads CBManager.authorization; the system prompt appears when the central
 *   manager is first created, so requestPermission() creates it and waits for the answer.
 *   A denied answer is permanent ("blocked"); iOS never re-prompts.
 * - Android requests BLUETOOTH_SCAN + BLUETOOTH_CONNECT on API 31+ and
 *   ACCESS_FINE_LOCATION on API 30 and below. "denied" means a prompt can be shown
 *   again; "blocked" means the user chose "don't ask again" and must use Settings.
 */
export interface PermissionApi {
  getPermissionState(): Promise<BlePermissionState>;
  /** Shows the system prompt when possible and resolves with the resulting state. */
  requestPermission(): Promise<BlePermissionState>;
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

/**
 * Service and characteristic discovery (M4). Native discovers the whole tree
 * while connecting, so this returns the cached table for a `ready` device and
 * rejects with `disconnected` otherwise. UUIDs arrive in canonical form.
 */
export interface GattDiscoveryApi {
  discoverServices(deviceId: string): Promise<GattService[]>;
}

export interface GattApi extends GattDiscoveryApi {
  readCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<number[]>;
  writeCharacteristic(request: WriteCharacteristicRequest): Promise<void>;
  setNotify(request: NotificationRequest): Promise<void>;
}

export interface NativeBleClient
  extends BluetoothAdapterApi, PermissionApi, ScanApi, ConnectionApi, GattApi {}
