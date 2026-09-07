import CoreBluetooth
import XCTest

@testable import Beacon

final class CharacteristicValueMapperTests: XCTestCase {

  private let deviceId = UUID(uuidString: "9E0C6C1B-5C0B-4C27-9D43-7A6E2C1D2B11")!
  private let receivedAt = Date(timeIntervalSince1970: 1_788_713_241.5)

  func testMapsEveryFieldWithCanonicalUuids() {
    let update = CharacteristicValueMapper.map(
      deviceId: deviceId,
      serviceUuid: CBUUID(string: "181D"),
      characteristicUuid: CBUUID(string: "2A9D"),
      value: Data([0x02, 0x9A, 0x1C, 0x00, 0x00]),
      receivedAt: receivedAt
    )

    XCTAssertEqual(update.deviceId, "9E0C6C1B-5C0B-4C27-9D43-7A6E2C1D2B11")
    XCTAssertEqual(update.serviceUuid, "0000181D-0000-1000-8000-00805F9B34FB")
    XCTAssertEqual(update.characteristicUuid, "00002A9D-0000-1000-8000-00805F9B34FB")
    XCTAssertEqual(update.bytes, Data([0x02, 0x9A, 0x1C, 0x00, 0x00]))
    XCTAssertEqual(update.timestamp, "2026-09-06T16:47:21.500Z")
  }

  func testKeepsVendorUuidsInTheirFullForm() {
    let update = CharacteristicValueMapper.map(
      deviceId: deviceId,
      serviceUuid: CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"),
      characteristicUuid: CBUUID(string: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"),
      value: Data([0x41]),
      receivedAt: receivedAt
    )
    XCTAssertEqual(update.serviceUuid, "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    XCTAssertEqual(update.characteristicUuid, "6E400003-B5A3-F393-E0A9-E50E24DCCA9E")
  }

  func testSendsAMissingValueAsAnEmptyPacket() {
    let update = CharacteristicValueMapper.map(
      deviceId: deviceId,
      serviceUuid: CBUUID(string: "180F"),
      characteristicUuid: CBUUID(string: "2A19"),
      value: nil,
      receivedAt: receivedAt
    )
    XCTAssertEqual(update.bytes, Data())
    XCTAssertEqual(update.payload["bytes"] as? [NSNumber], [])
  }

  func testPayloadMatchesTheBridgeShape() {
    let payload = CharacteristicValueMapper.map(
      deviceId: deviceId,
      serviceUuid: CBUUID(string: "180D"),
      characteristicUuid: CBUUID(string: "2A37"),
      value: Data([0x00, 0x48]),
      receivedAt: receivedAt
    ).payload

    XCTAssertEqual(Set(payload.keys), ["deviceId", "serviceUuid", "characteristicUuid", "bytes", "timestamp"])
    XCTAssertEqual(payload["deviceId"] as? String, deviceId.uuidString)
    XCTAssertEqual(payload["serviceUuid"] as? String, "0000180D-0000-1000-8000-00805F9B34FB")
    XCTAssertEqual(payload["characteristicUuid"] as? String, "00002A37-0000-1000-8000-00805F9B34FB")
    XCTAssertEqual(payload["bytes"] as? [NSNumber], [0, 72])
    XCTAssertEqual(payload["timestamp"] as? String, "2026-09-06T16:47:21.500Z")
  }

  func testSubscriptionKeyJoinsCanonicalUuids() {
    let key = CharacteristicValueMapper.subscriptionKey(
      serviceUuid: CBUUID(string: "180D"),
      characteristicUuid: CBUUID(string: "2A37")
    )
    XCTAssertEqual(key, "0000180D-0000-1000-8000-00805F9B34FB/00002A37-0000-1000-8000-00805F9B34FB")
  }

  func testSubscriptionKeyUsesTheSameUuidsAsTheEvent() {
    let service = CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    let characteristic = CBUUID(string: "2A37")
    let update = CharacteristicValueMapper.map(
      deviceId: deviceId,
      serviceUuid: service,
      characteristicUuid: characteristic,
      value: Data(),
      receivedAt: receivedAt
    )
    XCTAssertEqual(
      CharacteristicValueMapper.subscriptionKey(serviceUuid: service, characteristicUuid: characteristic),
      "\(update.serviceUuid)/\(update.characteristicUuid)"
    )
  }
}
