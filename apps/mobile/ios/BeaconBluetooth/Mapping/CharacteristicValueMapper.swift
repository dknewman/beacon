import CoreBluetooth
import Foundation

/// One notification or indication in the shape of `CharacteristicValueChangedEvent`
/// (`characteristic.value_changed` in `@beacon/ble-contracts`). Built by
/// `CharacteristicValueMapper`, sent to JavaScript through `payload`.
public struct CharacteristicValueUpdate: Equatable {
  public let deviceId: String
  public let serviceUuid: String
  public let characteristicUuid: String
  public let bytes: Data
  public let timestamp: String

  /// Dictionary form matching the codegen event. Every field is required, so none is omitted.
  public var payload: [String: Any] {
    [
      "deviceId": deviceId,
      "serviceUuid": serviceUuid,
      "characteristicUuid": characteristicUuid,
      "bytes": ByteArrayMapper.numbers(from: bytes),
      "timestamp": timestamp,
    ]
  }
}

/// Pure mapping from a CoreBluetooth value update to the shared event shape. Takes the
/// callback's pieces individually so it is unit tested without a `CBCharacteristic`.
public enum CharacteristicValueMapper {

  /// Builds the event for a value the peripheral pushed. UUIDs go out in the canonical 128-bit
  /// form (`GattMapper.canonicalUuid`) rather than CoreBluetooth's abbreviated one, so the
  /// JavaScript side matches a packet to its subscription by plain equality. `receivedAt` is
  /// stamped on the manager's queue, before the bridge hop, so a burst keeps its order and
  /// spacing. A nil `value` becomes an empty packet rather than being dropped.
  public static func map(
    deviceId: UUID,
    serviceUuid: CBUUID,
    characteristicUuid: CBUUID,
    value: Data?,
    receivedAt: Date
  ) -> CharacteristicValueUpdate {
    CharacteristicValueUpdate(
      deviceId: deviceId.uuidString,
      serviceUuid: canonical(serviceUuid),
      characteristicUuid: canonical(characteristicUuid),
      bytes: value ?? Data(),
      timestamp: AdvertisementMapper.isoTimestamp(receivedAt)
    )
  }

  /// The key under which a session tracks an active subscription: canonical service and
  /// characteristic UUIDs joined by "/", the same pair JavaScript addresses `setNotify` with.
  public static func subscriptionKey(serviceUuid: CBUUID, characteristicUuid: CBUUID) -> String {
    "\(canonical(serviceUuid))/\(canonical(characteristicUuid))"
  }

  /// `CBUUID.uuidString` is always a well-formed 16-bit, 32-bit or 128-bit UUID, so the fallback
  /// to the raw string is defensive only.
  private static func canonical(_ uuid: CBUUID) -> String {
    GattMapper.canonicalUuid(uuid.uuidString) ?? uuid.uuidString
  }
}
