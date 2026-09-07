import type {
  BluetoothAdapterApi,
  ConnectionApi,
  GattDiscoveryApi,
  GattNotifyApi,
  GattValueApi,
  PermissionApi,
  ScanApi,
} from '@beacon/ble-contracts';

/**
 * The slice of the NativeBleClient contract implemented so far.
 * M0: BluetoothAdapterApi. M1: PermissionApi. M2: ScanApi. M3: ConnectionApi.
 * M4: GattDiscoveryApi. M5: GattValueApi. M6: GattNotifyApi. With every native
 * segment in place this is the whole contract; the alias stays so screens keep
 * depending on one name.
 */
export type BleClient = BluetoothAdapterApi &
  PermissionApi &
  ScanApi &
  ConnectionApi &
  GattDiscoveryApi &
  GattValueApi &
  GattNotifyApi;
