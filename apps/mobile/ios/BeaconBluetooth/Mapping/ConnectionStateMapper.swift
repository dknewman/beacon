import CoreBluetooth

/// Connection vocabulary shared with TypeScript (`ConnectionState` in `@beacon/ble-contracts`).
/// Raw values are the wire format. Native emits every transition; JavaScript mirrors them.
public enum BleConnectionState: String, CaseIterable {
  case disconnected
  case connecting
  case connected
  case discoveringServices = "discovering_services"
  case ready
  case disconnecting
  case failed
}

/// Pure mapping from `CBPeripheralState` to the shared vocabulary, used to answer state
/// questions for peripherals this app did not connect itself (e.g. after a relaunch).
public enum ConnectionStateMapper {
  public static func map(_ state: CBPeripheralState) -> BleConnectionState {
    switch state {
    case .disconnected: return .disconnected
    case .connecting: return .connecting
    case .connected: return .connected
    case .disconnecting: return .disconnecting
    @unknown default: return .disconnected
    }
  }
}
