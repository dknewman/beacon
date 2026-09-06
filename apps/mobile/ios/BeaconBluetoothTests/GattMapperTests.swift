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
}
