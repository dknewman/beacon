import CoreBluetooth
import Foundation

/// Error codes shared with TypeScript (`BleErrorCode` in `@beacon/ble-contracts`).
/// Raw values are the wire format and must match that union exactly.
public enum BleErrorCode: String, CaseIterable {
  case bluetoothUnsupported = "bluetooth_unsupported"
  case bluetoothPoweredOff = "bluetooth_powered_off"
  case permissionDenied = "permission_denied"
  case scanFailed = "scan_failed"
  case deviceNotFound = "device_not_found"
  case connectionTimeout = "connection_timeout"
  case connectionFailed = "connection_failed"
  case disconnected
  case serviceNotFound = "service_not_found"
  case characteristicNotFound = "characteristic_not_found"
  case readFailed = "read_failed"
  case writeFailed = "write_failed"
  case subscriptionFailed = "subscription_failed"
  case invalidPayload = "invalid_payload"
  case nativeFailure = "native_failure"
  case unknown
}

/// A BLE failure with a contract code plus platform diagnostics for developer mode.
public struct BleError: Error, Equatable {
  public let code: BleErrorCode
  public let message: String
  public let nativeCode: String?
  public let nativeDomain: String?

  public init(code: BleErrorCode, message: String, nativeCode: String? = nil, nativeDomain: String? = nil) {
    self.code = code
    self.message = message
    self.nativeCode = nativeCode
    self.nativeDomain = nativeDomain
  }

  /// Maps CoreBluetooth and arbitrary errors onto the contract. `fallback` names the operation
  /// that failed so generic CoreBluetooth errors still produce a meaningful code.
  public static func from(_ error: Error, fallback: BleErrorCode = .nativeFailure) -> BleError {
    if let bleError = error as? BleError {
      return bleError
    }
    let nsError = error as NSError
    let code: BleErrorCode
    if nsError.domain == CBErrorDomain, let cbCode = CBError.Code(rawValue: nsError.code) {
      code = map(cbCode, fallback: fallback)
    } else {
      code = fallback
    }
    return BleError(
      code: code,
      message: nsError.localizedDescription,
      nativeCode: String(nsError.code),
      nativeDomain: nsError.domain
    )
  }

  private static func map(_ code: CBError.Code, fallback: BleErrorCode) -> BleErrorCode {
    switch code {
    case .connectionTimeout: return .connectionTimeout
    case .connectionFailed, .connectionLimitReached: return .connectionFailed
    case .notConnected, .peripheralDisconnected: return .disconnected
    case .unknownDevice: return .deviceNotFound
    default: return fallback
    }
  }

  /// Dictionary form matching `BleErrorInfo` on the TypeScript side.
  public var payload: [String: Any] {
    var dictionary: [String: Any] = ["code": code.rawValue, "message": message]
    if let nativeCode { dictionary["nativeCode"] = nativeCode }
    if let nativeDomain { dictionary["nativeDomain"] = nativeDomain }
    return dictionary
  }

  /// `NSError` form for promise rejections; the bridge exposes `code` to JavaScript.
  public var nsError: NSError {
    NSError(domain: "com.beacon.bluetooth", code: 0, userInfo: [NSLocalizedDescriptionKey: message] as [String: Any])
  }
}
