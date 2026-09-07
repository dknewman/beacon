import CoreBluetooth
import Foundation

/// A discovered peripheral in the shape of `BleDevice` (`@beacon/ble-contracts`).
/// Built by `AdvertisementMapper`, sent to JavaScript through `payload`.
public struct DiscoveredPeripheral: Equatable {
  public let id: String
  public let name: String?
  public let localName: String?
  public let rssi: Int?
  public let connectable: Bool?
  public let manufacturerData: String?
  public let serviceUuids: [String]
  public let lastSeenAt: String

  /// Dictionary form matching `DeviceDiscoveredEvent` in the codegen spec. Absent optionals are
  /// omitted rather than sent as null so the zod schema sees `undefined`.
  public var payload: [String: Any] {
    var dictionary: [String: Any] = [
      "id": id,
      "serviceUuids": serviceUuids,
      "lastSeenAt": lastSeenAt,
    ]
    if let name { dictionary["name"] = name }
    if let localName { dictionary["localName"] = localName }
    if let rssi { dictionary["rssi"] = rssi }
    if let connectable { dictionary["connectable"] = connectable }
    if let manufacturerData { dictionary["manufacturerData"] = manufacturerData }
    return dictionary
  }
}

/// Pure mapping from a CoreBluetooth discovery callback to the shared device shape.
/// Takes the callback's pieces individually so it can be unit tested without a `CBPeripheral`.
public enum AdvertisementMapper {

  /// CoreBluetooth reports this RSSI when the value is unavailable.
  static let unavailableRssi = 127

  public static func map(
    identifier: UUID,
    peripheralName: String?,
    advertisementData: [String: Any],
    rssi: NSNumber,
    seenAt: Date
  ) -> DiscoveredPeripheral {
    let rssiValue = rssi.intValue
    let connectable = (advertisementData[CBAdvertisementDataIsConnectable] as? NSNumber)?.boolValue
    let manufacturer = (advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data).map(hexString)
    let advertised = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
    let overflow = advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? []

    return DiscoveredPeripheral(
      id: identifier.uuidString,
      name: nonEmpty(peripheralName),
      localName: nonEmpty(advertisementData[CBAdvertisementDataLocalNameKey] as? String),
      rssi: rssiValue == unavailableRssi ? nil : rssiValue,
      connectable: connectable,
      manufacturerData: manufacturer.flatMap { $0.isEmpty ? nil : $0 },
      serviceUuids: uniqueUuidStrings(advertised + overflow),
      lastSeenAt: isoTimestamp(seenAt)
    )
  }

  /// Uppercase hex without separators, the `manufacturerData` wire format.
  public static func hexString(_ data: Data) -> String {
    data.map { String(format: "%02X", $0) }.joined()
  }

  /// ISO-8601 with millisecond precision and a `Z` suffix, the `lastSeenAt` and `timestamp`
  /// wire format.
  public static func isoTimestamp(_ date: Date) -> String {
    isoFormatter.string(from: date)
  }

  /// Parses the service UUID strings JavaScript passes to `startScan` (short or full form).
  /// Returns nil for anything `CBUUID(string:)` would raise an exception on.
  public static func parseServiceUuid(_ value: String) -> CBUUID? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let hex = CharacterSet(charactersIn: "0123456789ABCDEF")
    let isHex = { (candidate: String) in
      !candidate.isEmpty && candidate.unicodeScalars.allSatisfy(hex.contains)
    }
    switch trimmed.count {
    case 4, 8:
      return isHex(trimmed) ? CBUUID(string: trimmed) : nil
    case 32:
      guard isHex(trimmed) else { return nil }
      let chars = Array(trimmed)
      let parts = [chars[0..<8], chars[8..<12], chars[12..<16], chars[16..<20], chars[20..<32]]
      return CBUUID(string: parts.map { String($0) }.joined(separator: "-"))
    case 36:
      return UUID(uuidString: trimmed) == nil ? nil : CBUUID(string: trimmed)
    default:
      return nil
    }
  }

  private static let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter
  }()

  private static func nonEmpty(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    return value
  }

  private static func uniqueUuidStrings(_ uuids: [CBUUID]) -> [String] {
    var seen = Set<String>()
    return uuids.compactMap { uuid in
      let string = uuid.uuidString
      return seen.insert(string).inserted ? string : nil
    }
  }
}
