import CoreBluetooth
import XCTest

@testable import Beacon

final class GattMapperTests: XCTestCase {

  func testWireValuesMatchTheTypeScriptCharacteristicPropertyUnion() {
    let expected = ["read", "write", "write_without_response", "notify", "indicate"]
    XCTAssertEqual(BleCharacteristicProperty.allCases.map(\.rawValue), expected)
  }

  func testPropertiesMapInContractOrderAndDropUnknownFlags() {
    let raw: CBCharacteristicProperties = [.indicate, .writeWithoutResponse, .read, .extendedProperties, .authenticatedSignedWrites]
    XCTAssertEqual(GattMapper.properties(raw), [.read, .writeWithoutResponse, .indicate])
    XCTAssertEqual(GattMapper.properties([]), [])
    XCTAssertEqual(GattMapper.properties([.notify, .write]), [.write, .notify])
  }

  func testCharacteristicPayloadMatchesTheBridgeShape() {
    let characteristic = GattMapper.characteristic(
      serviceUuid: CBUUID(string: "180D"),
      uuid: CBUUID(string: "2A37"),
      properties: [.notify]
    )
    XCTAssertEqual(characteristic.serviceUuid, "180D")
    XCTAssertEqual(characteristic.uuid, "2A37")
    let payload = characteristic.payload
    XCTAssertEqual(payload["serviceUuid"] as? String, "180D")
    XCTAssertEqual(payload["uuid"] as? String, "2A37")
    XCTAssertEqual(payload["properties"] as? [String], ["notify"])
  }

  func testServicePayloadNestsCharacteristics() {
    let service = DiscoveredService(
      uuid: "180F",
      primary: true,
      characteristics: [
        DiscoveredCharacteristic(serviceUuid: "180F", uuid: "2A19", properties: [.read, .notify])
      ]
    )
    let payload = service.payload
    XCTAssertEqual(payload["uuid"] as? String, "180F")
    XCTAssertEqual(payload["primary"] as? Bool, true)
    let characteristics = payload["characteristics"] as? [[String: Any]]
    XCTAssertEqual(characteristics?.count, 1)
    XCTAssertEqual(characteristics?.first?["properties"] as? [String], ["read", "notify"])
  }

  func testCanonicalUuidMatchesTheTypeScriptNormalizeUuid() {
    let battery = "0000180F-0000-1000-8000-00805F9B34FB"
    XCTAssertEqual(GattMapper.canonicalUuid("180F"), battery)
    XCTAssertEqual(GattMapper.canonicalUuid("180f"), battery)
    XCTAssertEqual(GattMapper.canonicalUuid("0x180F"), battery)
    XCTAssertEqual(GattMapper.canonicalUuid("0000180F"), battery)
    XCTAssertEqual(GattMapper.canonicalUuid(" 0000180f-0000-1000-8000-00805f9b34fb "), battery)
    XCTAssertEqual(GattMapper.canonicalUuid(battery), battery)
    XCTAssertEqual(
      GattMapper.canonicalUuid("6e400001b5a3f393e0a9e50e24dcca9e"),
      "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
    )
  }

  func testCanonicalUuidAgreesWithCoreBluetoothRendering() {
    XCTAssertEqual(GattMapper.canonicalUuid(CBUUID(string: "180F").uuidString), GattMapper.canonicalUuid("180F"))
    XCTAssertEqual(
      GattMapper.canonicalUuid(CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E").uuidString),
      "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
    )
  }

  func testCanonicalUuidRejectsAnythingThatIsNotAUuid() {
    XCTAssertNil(GattMapper.canonicalUuid(""))
    XCTAssertNil(GattMapper.canonicalUuid("battery"))
    XCTAssertNil(GattMapper.canonicalUuid("180G"))
    XCTAssertNil(GattMapper.canonicalUuid("0000180F-0000-1000-8000-00805F9B34F"))
    XCTAssertNil(GattMapper.canonicalUuid("0000180F0000-1000-8000-00805F9B34FB"))
  }
}
