import CoreBluetooth
import XCTest

@testable import Beacon

final class ConnectionStateMapperTests: XCTestCase {

  func testWireValuesMatchTheTypeScriptConnectionStateUnion() {
    let expected = [
      "disconnected", "connecting", "connected", "discovering_services", "ready", "disconnecting",
      "failed",
    ]
    XCTAssertEqual(BleConnectionState.allCases.map(\.rawValue), expected)
  }

  func testPeripheralStatesMapOntoTheVocabulary() {
    XCTAssertEqual(ConnectionStateMapper.map(.disconnected), .disconnected)
    XCTAssertEqual(ConnectionStateMapper.map(.connecting), .connecting)
    XCTAssertEqual(ConnectionStateMapper.map(.connected), .connected)
    XCTAssertEqual(ConnectionStateMapper.map(.disconnecting), .disconnecting)
  }
}
