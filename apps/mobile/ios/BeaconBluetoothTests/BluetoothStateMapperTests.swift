import CoreBluetooth
import XCTest

@testable import Beacon

final class BluetoothStateMapperTests: XCTestCase {

  func testEveryManagerStateMapsToTheSharedVocabulary() {
    XCTAssertEqual(BluetoothStateMapper.map(.unknown), .unknown)
    XCTAssertEqual(BluetoothStateMapper.map(.resetting), .resetting)
    XCTAssertEqual(BluetoothStateMapper.map(.unsupported), .unsupported)
    XCTAssertEqual(BluetoothStateMapper.map(.unauthorized), .unauthorized)
    XCTAssertEqual(BluetoothStateMapper.map(.poweredOff), .poweredOff)
    XCTAssertEqual(BluetoothStateMapper.map(.poweredOn), .poweredOn)
  }

  func testWireValuesMatchTheTypeScriptBluetoothStateUnion() {
    let expected = ["unknown", "unsupported", "unauthorized", "powered_off", "powered_on", "resetting"]
    XCTAssertEqual(BleAdapterState.allCases.map(\.rawValue), expected)
  }
}
