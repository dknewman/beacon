import CoreBluetooth

/// Permission vocabulary shared with TypeScript (`BlePermissionState` in `@beacon/ble-contracts`).
/// Raw values are the wire format.
public enum BlePermissionState: String, CaseIterable {
  case unknown
  case notRequested = "not_requested"
  case granted
  case denied
  case blocked
}

/// Pure mapping from CoreBluetooth authorization to the shared vocabulary.
public enum AuthorizationMapper {
  /// iOS never shows the Bluetooth prompt a second time, so both `.denied` and `.restricted`
  /// map to `blocked`: the only way forward is the Settings app. The re-promptable `denied`
  /// state is an Android-only outcome and is never produced here.
  public static func map(_ authorization: CBManagerAuthorization) -> BlePermissionState {
    switch authorization {
    case .notDetermined: return .notRequested
    case .restricted, .denied: return .blocked
    case .allowedAlways: return .granted
    @unknown default: return .unknown
    }
  }
}
