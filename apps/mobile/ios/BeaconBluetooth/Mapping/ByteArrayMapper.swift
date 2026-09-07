import Foundation

/// Converts characteristic values between the bridge's number arrays and `Data`. Pure so the
/// range validation PROJECT.md 16 asks for ("reject bytes above 255") is unit tested.
public enum ByteArrayMapper {

  /// The unsigned bytes JavaScript sent, or nil when any element is not a whole number in
  /// `0...255`. React Native delivers every JavaScript number as a double-backed `NSNumber`,
  /// so a fractional, negative, oversized or non-finite value is caught here rather than
  /// truncated on its way into `Data`.
  public static func bytes(from numbers: [NSNumber]) -> [UInt8]? {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(numbers.count)
    for number in numbers {
      let value = number.doubleValue
      guard value >= 0, value <= 255, value.rounded() == value else { return nil }
      bytes.append(UInt8(value))
    }
    return bytes
  }

  /// A characteristic value as the unsigned byte array `readCharacteristic` resolves with.
  public static func numbers(from data: Data) -> [NSNumber] {
    data.map { NSNumber(value: $0) }
  }
}
