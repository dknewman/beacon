import type { BluetoothState } from './bluetooth-state';
import type { ConnectionState } from './connection-state';
import type { BleDevice } from './device';
import type { BleErrorInfo } from './errors';

/**
 * Discriminated union of every event the native layer can emit.
 *
 * The codegen spec (apps/mobile/src/native/specs) exposes one typed emitter per
 * event; the bridge wrapper folds them into this union after runtime validation
 * (@beacon/validation). Application code never sees an unvalidated event.
 */
export type NativeBleEvent =
  | BluetoothStateChangedEvent
  | ScanDeviceDiscoveredEvent
  | ConnectionStateChangedEvent
  | CharacteristicValueChangedEvent
  | BleErrorEvent;

export interface BluetoothStateChangedEvent {
  type: 'bluetooth.state_changed';
  state: BluetoothState;
}

export interface ScanDeviceDiscoveredEvent {
  type: 'scan.device_discovered';
  device: BleDevice;
}

export interface ConnectionStateChangedEvent {
  type: 'connection.state_changed';
  deviceId: string;
  state: ConnectionState;
}

export interface CharacteristicValueChangedEvent {
  type: 'characteristic.value_changed';
  deviceId: string;
  serviceUuid: string;
  characteristicUuid: string;
  bytes: number[];
  timestamp: string;
}

export interface BleErrorEvent {
  type: 'ble.error';
  deviceId?: string;
  error: BleErrorInfo;
}

export type NativeBleEventType = NativeBleEvent['type'];
