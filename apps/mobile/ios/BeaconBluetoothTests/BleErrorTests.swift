import CoreBluetooth
import XCTest

@testable import Beacon

final class BleErrorTests: XCTestCase {

  func testWireValuesMatchTheTypeScriptBleErrorCodeUnion() {
    let expected = [
      "bluetooth_unsupported", "bluetooth_powered_off", "permission_denied", "scan_failed",
      "device_not_found", "connection_timeout", "connection_failed", "disconnected",
      "service_not_found", "characteristic_not_found", "read_failed", "write_failed",
      "subscription_failed", "invalid_payload", "native_failure", "unknown",
    ]
    XCTAssertEqual(BleErrorCode.allCases.map(\.rawValue), expected)
  }

  func testCoreBluetoothErrorsMapToContractCodes() {
    XCTAssertEqual(BleError.from(cbError(.connectionTimeout)).code, .connectionTimeout)
    XCTAssertEqual(BleError.from(cbError(.connectionFailed)).code, .connectionFailed)
    XCTAssertEqual(BleError.from(cbError(.peripheralDisconnected)).code, .disconnected)
    XCTAssertEqual(BleError.from(cbError(.notConnected)).code, .disconnected)
    XCTAssertEqual(BleError.from(cbError(.unknownDevice)).code, .deviceNotFound)
  }

  func testUnmappedCoreBluetoothErrorsUseTheOperationFallback() {
    let error = BleError.from(cbError(.invalidParameters), fallback: .writeFailed)
    XCTAssertEqual(error.code, .writeFailed)
    XCTAssertEqual(error.nativeDomain, CBErrorDomain)
    XCTAssertEqual(error.nativeCode, String(CBError.Code.invalidParameters.rawValue))
  }

  func testForeignErrorsKeepDiagnosticsAndFallback() {
    let foreign = NSError(domain: "com.example", code: 42, userInfo: [NSLocalizedDescriptionKey: "boom"])
    let error = BleError.from(foreign)
    XCTAssertEqual(error.code, .nativeFailure)
    XCTAssertEqual(error.message, "boom")
    XCTAssertEqual(error.nativeCode, "42")
    XCTAssertEqual(error.nativeDomain, "com.example")
  }

  func testBleErrorPassesThroughUnchanged() {
    let original = BleError(code: .readFailed, message: "nope", nativeCode: "1")
    XCTAssertEqual(BleError.from(original), original)
  }

  func testPayloadOmitsAbsentDiagnostics() {
    let payload = BleError(code: .unknown, message: "x").payload
    XCTAssertEqual(payload["code"] as? String, "unknown")
    XCTAssertEqual(payload["message"] as? String, "x")
    XCTAssertNil(payload["nativeCode"])
    XCTAssertNil(payload["nativeDomain"])
  }

  private func cbError(_ code: CBError.Code) -> NSError {
    NSError(domain: CBErrorDomain, code: code.rawValue, userInfo: nil)
  }
}
