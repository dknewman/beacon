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
}
