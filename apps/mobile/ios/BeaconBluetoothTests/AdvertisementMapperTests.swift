import CoreBluetooth
import XCTest

@testable import Beacon

final class AdvertisementMapperTests: XCTestCase {

  private let identifier = UUID(uuidString: "9E0C6C1B-5C0B-4C27-9D43-7A6E2C1D2B11")!
  private let seenAt = Date(timeIntervalSince1970: 1_788_713_241.5)

  func testMapsEveryAdvertisementField() {
    let device = AdvertisementMapper.map(
      identifier: identifier,
      peripheralName: "Polar H10",
      advertisementData: [
        CBAdvertisementDataLocalNameKey: "Polar H10 1A2B3C",
        CBAdvertisementDataIsConnectable: NSNumber(value: true),
        CBAdvertisementDataManufacturerDataKey: Data([0x6B, 0x00, 0x01, 0xAB]),
        CBAdvertisementDataServiceUUIDsKey: [CBUUID(string: "180D"), CBUUID(string: "180F")],
        CBAdvertisementDataOverflowServiceUUIDsKey: [CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")],
      ],
      rssi: NSNumber(value: -55),
      seenAt: seenAt
    )

    XCTAssertEqual(device.id, "9E0C6C1B-5C0B-4C27-9D43-7A6E2C1D2B11")
    XCTAssertEqual(device.name, "Polar H10")
    XCTAssertEqual(device.localName, "Polar H10 1A2B3C")
    XCTAssertEqual(device.rssi, -55)
    XCTAssertEqual(device.connectable, true)
    XCTAssertEqual(device.manufacturerData, "6B0001AB")
    XCTAssertEqual(device.serviceUuids, ["180D", "180F", "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"])
    XCTAssertEqual(device.lastSeenAt, "2026-09-06T16:47:21.500Z")
  }

  func testOmitsAbsentAndUnavailableValues() {
    let device = AdvertisementMapper.map(
      identifier: identifier,
      peripheralName: "",
      advertisementData: [CBAdvertisementDataManufacturerDataKey: Data()],
      rssi: NSNumber(value: AdvertisementMapper.unavailableRssi),
      seenAt: seenAt
    )
    XCTAssertNil(device.name)
    XCTAssertNil(device.localName)
    XCTAssertNil(device.rssi)
    XCTAssertNil(device.connectable)
    XCTAssertNil(device.manufacturerData)
    XCTAssertEqual(device.serviceUuids, [])

    let payload = device.payload
    XCTAssertEqual(Set(payload.keys), ["id", "serviceUuids", "lastSeenAt"])
  }

  func testPayloadCarriesEveryPresentField() {
    let payload = AdvertisementMapper.map(
      identifier: identifier,
      peripheralName: "QN Scale",
      advertisementData: [
        CBAdvertisementDataIsConnectable: NSNumber(value: false),
        CBAdvertisementDataServiceUUIDsKey: [CBUUID(string: "181D"), CBUUID(string: "181D")],
      ],
      rssi: NSNumber(value: -70),
      seenAt: seenAt
    ).payload

    XCTAssertEqual(payload["id"] as? String, identifier.uuidString)
    XCTAssertEqual(payload["name"] as? String, "QN Scale")
    XCTAssertEqual(payload["rssi"] as? Int, -70)
    XCTAssertEqual(payload["connectable"] as? Bool, false)
    XCTAssertEqual(payload["serviceUuids"] as? [String], ["181D"])
    XCTAssertEqual(payload["lastSeenAt"] as? String, "2026-09-06T16:47:21.500Z")
    XCTAssertNil(payload["localName"])
    XCTAssertNil(payload["manufacturerData"])
  }

  func testHexEncodingIsUppercaseWithoutSeparators() {
    XCTAssertEqual(AdvertisementMapper.hexString(Data([0x00, 0x0a, 0xff])), "000AFF")
    XCTAssertEqual(AdvertisementMapper.hexString(Data()), "")
  }

  func testParsesServiceUuidsInEveryAcceptedForm() {
    XCTAssertEqual(AdvertisementMapper.parseServiceUuid("180d")?.uuidString, "180D")
    XCTAssertEqual(AdvertisementMapper.parseServiceUuid(" 0000180D ")?.uuidString, "0000180D")
    XCTAssertEqual(
      AdvertisementMapper.parseServiceUuid("6e400001b5a3f393e0a9e50e24dcca9e")?.uuidString,
      "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
    )
    XCTAssertEqual(
      AdvertisementMapper.parseServiceUuid("0000180D-0000-1000-8000-00805F9B34FB"),
      CBUUID(string: "0000180D-0000-1000-8000-00805F9B34FB")
    )
  }

  func testRejectsInvalidServiceUuidsInsteadOfCrashing() {
    XCTAssertNil(AdvertisementMapper.parseServiceUuid(""))
    XCTAssertNil(AdvertisementMapper.parseServiceUuid("heart-rate"))
    XCTAssertNil(AdvertisementMapper.parseServiceUuid("180G"))
    XCTAssertNil(AdvertisementMapper.parseServiceUuid("0000180D-0000-1000-8000-00805F9B34F"))
  }
}
