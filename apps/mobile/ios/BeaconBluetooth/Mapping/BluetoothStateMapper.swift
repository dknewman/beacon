import CoreBluetooth

/// Adapter state vocabulary shared with TypeScript (`BluetoothState` in `@beacon/ble-contracts`).
/// Raw values are the wire format; JavaScript validates them at runtime and rejects anything else.
public enum BleAdapterState: String, CaseIterable {
  case unknown
  case unsupported
  case unauthorized
  case poweredOff = "powered_off"
  case poweredOn = "powered_on"
  case resetting
}

/// Pure mapping from CoreBluetooth manager state to the shared vocabulary. Unit tested without hardware.
public enum BluetoothStateMapper {
  public static func map(_ state: CBManagerState) -> BleAdapterState {
    switch state {
    case .unknown: return .unknown
    case .resetting: return .resetting
    case .unsupported: return .unsupported
    case .unauthorized: return .unauthorized
    case .poweredOff: return .poweredOff
    case .poweredOn: return .poweredOn
    @unknown default: return .unknown
    }
  }
}
