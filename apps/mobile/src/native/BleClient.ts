import type {
  BluetoothAdapterApi,
  ConnectionApi,
  PermissionApi,
  ScanApi,
} from '@beacon/ble-contracts';

/**
 * The slice of the NativeBleClient contract implemented so far.
 * M0: BluetoothAdapterApi. M1: PermissionApi. M2: ScanApi. M3: ConnectionApi.
 * Later milestones widen this type as their native segments land, so screens
 * never see a method that has no real implementation behind it.
 */
export type BleClient = BluetoothAdapterApi & PermissionApi & ScanApi & ConnectionApi;
