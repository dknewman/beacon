import CoreBluetooth
import Foundation

/// Characteristic property vocabulary shared with TypeScript (`CharacteristicProperty`).
/// Raw values are the wire format; order matches the TypeScript union.
public enum BleCharacteristicProperty: String, CaseIterable {
  case read
  case write
  case writeWithoutResponse = "write_without_response"
  case notify
  case indicate
}

/// A discovered characteristic in the shape of `GattCharacteristic`.
public struct DiscoveredCharacteristic: Equatable {
  public let serviceUuid: String
  public let uuid: String
  public let properties: [BleCharacteristicProperty]

  public var payload: [String: Any] {
    ["serviceUuid": serviceUuid, "uuid": uuid, "properties": properties.map(\.rawValue)]
  }
}

/// A discovered service in the shape of `GattService`.
public struct DiscoveredService: Equatable {
  public let uuid: String
  public let primary: Bool
  public let characteristics: [DiscoveredCharacteristic]

  public var payload: [String: Any] {
    ["uuid": uuid, "primary": primary, "characteristics": characteristics.map(\.payload)]
  }
}

/// Pure mapping from CoreBluetooth GATT objects to the shared shapes. The property mapping takes
/// the option set directly so it is unit tested without a `CBCharacteristic`.
public enum GattMapper {

  /// Maps `CBCharacteristicProperties` onto the contract vocabulary, in contract order.
  /// Extended and signed-write flags have no counterpart yet and are dropped.
  public static func properties(_ raw: CBCharacteristicProperties) -> [BleCharacteristicProperty] {
    var result: [BleCharacteristicProperty] = []
    if raw.contains(.read) { result.append(.read) }
    if raw.contains(.write) { result.append(.write) }
    if raw.contains(.writeWithoutResponse) { result.append(.writeWithoutResponse) }
    if raw.contains(.notify) { result.append(.notify) }
    if raw.contains(.indicate) { result.append(.indicate) }
    return result
  }

  public static func characteristic(
    serviceUuid: CBUUID,
    uuid: CBUUID,
    properties raw: CBCharacteristicProperties
  ) -> DiscoveredCharacteristic {
    DiscoveredCharacteristic(
      serviceUuid: serviceUuid.uuidString,
      uuid: uuid.uuidString,
      properties: properties(raw)
    )
  }

  public static func service(_ service: CBService) -> DiscoveredService {
    DiscoveredService(
      uuid: service.uuid.uuidString,
      primary: service.isPrimary,
      characteristics: (service.characteristics ?? []).map {
        characteristic(serviceUuid: service.uuid, uuid: $0.uuid, properties: $0.properties)
      }
    )
  }

  public static func services(_ services: [CBService]) -> [DiscoveredService] {
    services.map(service)
  }

  /// The canonical 128-bit, uppercase, hyphenated form of a UUID string, matching
  /// `normalizeUuid` in `@beacon/ble-contracts`; nil when the string is not a UUID.
  ///
  /// CoreBluetooth abbreviates SIG-assigned UUIDs (`"180F"`) while JavaScript sends the full
  /// form, so characteristic lookups compare this form on both sides. Accepts 16-bit, 32-bit,
  /// unhyphenated and hyphenated 128-bit input in either case, with an optional `0x` prefix.
  public static func canonicalUuid(_ value: String) -> String? {
    var cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    if cleaned.hasPrefix("0X") {
      cleaned.removeFirst(2)
    }
    let hex = CharacterSet(charactersIn: "0123456789ABCDEF")
    let isHex = !cleaned.isEmpty && cleaned.unicodeScalars.allSatisfy(hex.contains)
    switch cleaned.count {
    case 4:
      return isHex ? "0000\(cleaned)\(baseUuidSuffix)" : nil
    case 8:
      return isHex ? cleaned + baseUuidSuffix : nil
    case 32:
      guard isHex else { return nil }
      let chars = Array(cleaned)
      let parts = [chars[0..<8], chars[8..<12], chars[12..<16], chars[16..<20], chars[20..<32]]
      return parts.map { String($0) }.joined(separator: "-")
    case 36:
      return UUID(uuidString: cleaned) == nil ? nil : cleaned
    default:
      return nil
    }
  }

  /// Tail of every UUID derived from the Bluetooth Base UUID.
  private static let baseUuidSuffix = "-0000-1000-8000-00805F9B34FB"
}
