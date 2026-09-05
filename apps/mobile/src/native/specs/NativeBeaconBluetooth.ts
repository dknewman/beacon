/**
 * Codegen spec for the BeaconBluetooth Turbo Native Module.
 *
 * This file is consumed by React Native Codegen. It must stay narrow and use
 * only codegen-compatible types (primitives, plain objects, Promise, EventEmitter).
 *
 * The rich domain typing (BluetoothState unions, discriminated event unions,
 * BleError) lives in @beacon/ble-contracts. Values crossing this boundary are
 * validated at runtime in src/native/BeaconBluetoothClient.ts before they enter
 * application state.
 *
 * Milestone scope: M0 exposes only the adapter state API and its change event.
 * Later milestones extend this spec (scan, connect, GATT) alongside the
 * Swift and Kotlin implementations.
 */
import { TurboModuleRegistry, type CodegenTypes, type TurboModule } from 'react-native';

/** Payload emitted whenever the platform Bluetooth adapter state changes. */
export type BluetoothStateChangedEvent = {
  /** Raw state string; see BluetoothState in @beacon/ble-contracts. */
  state: string;
};

export interface Spec extends TurboModule {
  /**
   * Resolves with the current adapter state as a string
   * (e.g. "powered_on"). Never rejects for adapter-state reasons; those are
   * represented as states, not errors.
   */
  getBluetoothState(): Promise<string>;

  /** Emitted on every adapter state transition after module initialization. */
  readonly onBluetoothStateChanged: CodegenTypes.EventEmitter<BluetoothStateChangedEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('BeaconBluetooth');
