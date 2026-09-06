import CoreBluetooth
import XCTest

@testable import Beacon

final class AuthorizationMapperTests: XCTestCase {

  func testNotDeterminedIsNotRequested() {
    XCTAssertEqual(AuthorizationMapper.map(.notDetermined), .notRequested)
  }

  func testAllowedIsGranted() {
    XCTAssertEqual(AuthorizationMapper.map(.allowedAlways), .granted)
  }

  func testRefusedAuthorizationsAreBlockedBecauseIOSNeverRepromts() {
    XCTAssertEqual(AuthorizationMapper.map(.denied), .blocked)
    XCTAssertEqual(AuthorizationMapper.map(.restricted), .blocked)
  }

  func testWireValuesMatchTheTypeScriptBlePermissionStateUnion() {
    let expected = ["unknown", "not_requested", "granted", "denied", "blocked"]
    XCTAssertEqual(BlePermissionState.allCases.map(\.rawValue), expected)
  }
}
