/**
 * Codegen spec for the BeaconBluetooth Turbo Native Module.
 *
 * This file is consumed by React Native Codegen. It must stay narrow and use
 * only codegen-compatible types (primitives, plain objects, arrays, Promise,
 * EventEmitter).
 *
 * The rich domain typing (BluetoothState unions, discriminated event unions,
 * BleError) lives in @beacon/ble-contracts. Values crossing this boundary are
 * validated at runtime in src/native/createNativeBleClient.ts before they enter
 * application state.
 *
 * Milestone scope: M0 added the adapter state API and its change event; M1 added
 * the permission API; M2 added scanning and the discovery/error events; M3 added
 * connections; M4 added service discovery; M5 added reads and writes; M6 added
 * notifications. Each addition lands alongside the Swift and Kotlin
 * implementations.
 */
import { TurboModuleRegistry, type CodegenTypes, type TurboModule } from 'react-native';

/** Payload emitted whenever the platform Bluetooth adapter state changes. */
export type BluetoothStateChangedEvent = {
  /** Raw state string; see BluetoothState in @beacon/ble-contracts. */
  state: string;
};

/**
 * One advertisement (or one batch of advertisements for the same peripheral)
 * as reported by the platform scanner. Shape mirrors BleDevice; UUID and hex
 * formatting are platform specific and normalized on the JavaScript side.
 */
export type DeviceDiscoveredEvent = {
  id: string;
  name?: string;
  localName?: string;
  rssi?: number;
  connectable?: boolean;
  manufacturerData?: string;
  serviceUuids: string[];
  lastSeenAt: string;
};

/** Emitted on every native connection transition; `state` is a ConnectionState wire value. */
export type ConnectionStateChangedEvent = {
  deviceId: string;
  state: string;
};

/** One characteristic as reported by the platform; `properties` are CharacteristicProperty wire values. */
export type GattCharacteristicPayload = {
  serviceUuid: string;
  uuid: string;
  properties: string[];
};

/** One service with its characteristics; UUID formatting is platform specific. */
export type GattServicePayload = {
  uuid: string;
  primary: boolean;
  characteristics: GattCharacteristicPayload[];
};

/**
 * One notification or indication. `bytes` are unsigned 0..255; `timestamp` is
 * the ISO-8601 instant native received the value, taken before the bridge hop
 * so a burst keeps its order and spacing.
 */
export type CharacteristicValueChangedEvent = {
  deviceId: string;
  serviceUuid: string;
  characteristicUuid: string;
  bytes: number[];
  timestamp: string;
};

/** Mirrors BleErrorInfo; `code` is a BleErrorCode wire value. */
export type BleErrorPayload = {
  code: string;
  message: string;
  nativeCode?: string;
  nativeDomain?: string;
};

/** A failure that is not the answer to a specific call (e.g. the scanner stopped itself). */
export type BleErrorEvent = {
  deviceId?: string;
  error: BleErrorPayload;
};

export interface Spec extends TurboModule {
  /**
   * Resolves with the current adapter state as a string
   * (e.g. "powered_on"). Never rejects for adapter-state reasons; those are
   * represented as states, not errors.
   */
  getBluetoothState(): Promise<string>;

  /**
   * Resolves with the current permission state as a string
   * (see BlePermissionState in @beacon/ble-contracts). Never shows a prompt.
   */
  getPermissionState(): Promise<string>;

  /**
   * Shows the platform permission prompt when one can still be shown and resolves
   * with the resulting permission state. Rejects with a BleErrorCode when the
   * platform cannot present a prompt (e.g. no foreground activity on Android).
   */
  requestPermission(): Promise<string>;

  /**
   * Starts a BLE scan. `serviceUuids` restricts discovery to peripherals
   * advertising any of them (empty array = every peripheral). With
   * `allowDuplicates` the platform reports repeated advertisements from the same
   * peripheral so RSSI can be tracked; native throttles them per peripheral.
   * Rejects with bluetooth_powered_off, permission_denied, bluetooth_unsupported
   * or scan_failed. Resolves immediately when a scan is already running.
   */
  startScan(serviceUuids: string[], allowDuplicates: boolean): Promise<void>;

  /** Stops the scan. Resolves even when no scan is running. */
  stopScan(): Promise<void>;

  /**
   * Connects to a peripheral and discovers its services. Resolves once the
   * connection is `ready`; every transition is also emitted on
   * onConnectionStateChanged. Rejects with device_not_found, connection_failed,
   * disconnected (cancelled by disconnect()) or bluetooth_powered_off. Resolves
   * immediately when the peripheral is already ready.
   */
  connect(deviceId: string): Promise<void>;

  /**
   * Disconnects, or cancels a connection attempt. Resolves once the platform has
   * reported the disconnect; resolves immediately when not connected.
   */
  disconnect(deviceId: string): Promise<void>;

  /** Reads the RSSI of a connected peripheral in dBm. Rejects with disconnected otherwise. */
  readRssi(deviceId: string): Promise<number>;

  /**
   * Returns the service and characteristic table discovered while connecting.
   * Rejects with disconnected unless the peripheral is `ready`.
   */
  discoverServices(deviceId: string): Promise<GattServicePayload[]>;

  /**
   * Reads a characteristic value as unsigned bytes. Queued behind other GATT
   * operations on the same peripheral. Rejects with disconnected,
   * characteristic_not_found or read_failed.
   */
  readCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<number[]>;

  /**
   * Writes unsigned bytes. `withResponse` waits for the peripheral's
   * acknowledgement; without it the call resolves once the bytes are handed to
   * the stack. Rejects with disconnected, characteristic_not_found or write_failed.
   */
  writeCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    bytes: number[],
    withResponse: boolean,
  ): Promise<void>;

  /**
   * Enables or disables notifications (or indications, whichever the
   * characteristic supports) and resolves once the peripheral has acknowledged
   * the change. Values then arrive on onCharacteristicValueChanged. Queued
   * behind other GATT operations on the same peripheral. Rejects with
   * disconnected, characteristic_not_found or subscription_failed. Every
   * subscription ends with the link.
   */
  setNotify(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    enabled: boolean,
  ): Promise<void>;

  /** Emitted on every adapter state transition after module initialization. */
  readonly onBluetoothStateChanged: CodegenTypes.EventEmitter<BluetoothStateChangedEvent>;

  /** Emitted for each (throttled) advertisement while a scan is running. */
  readonly onDeviceDiscovered: CodegenTypes.EventEmitter<DeviceDiscoveredEvent>;

  /** Emitted for every per-device connection transition, including remote disconnects. */
  readonly onConnectionStateChanged: CodegenTypes.EventEmitter<ConnectionStateChangedEvent>;

  /** Emitted for every notification or indication on a subscribed characteristic. */
  readonly onCharacteristicValueChanged: CodegenTypes.EventEmitter<CharacteristicValueChangedEvent>;

  /**
   * Emitted for asynchronous failures: the scanner stopping itself (no deviceId),
   * a failed connection attempt or a remote disconnect (with deviceId, sent
   * before the matching `disconnected` state).
   */
  readonly onBleError: CodegenTypes.EventEmitter<BleErrorEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('BeaconBluetooth');
