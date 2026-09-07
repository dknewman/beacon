import Foundation
import XCTest

@testable import Beacon

final class ByteArrayMapperTests: XCTestCase {

  func testAcceptsWholeNumbersWithinTheByteRange() {
    XCTAssertEqual(ByteArrayMapper.bytes(from: [0, 1, 127, 255]), [0, 1, 127, 255])
    XCTAssertEqual(ByteArrayMapper.bytes(from: []), [])
  }

  func testAcceptsDoubleBackedNumbersAsReactNativeDeliversThem() {
    let numbers = [NSNumber(value: 42.0), NSNumber(value: 255.0), NSNumber(value: 0.0)]
    XCTAssertEqual(ByteArrayMapper.bytes(from: numbers), [42, 255, 0])
  }

  func testRejectsValuesOutsideTheByteRange() {
    XCTAssertNil(ByteArrayMapper.bytes(from: [256]))
    XCTAssertNil(ByteArrayMapper.bytes(from: [-1]))
    XCTAssertNil(ByteArrayMapper.bytes(from: [1, 2, 300, 4]))
  }

  func testRejectsFractionalAndNonFiniteValues() {
    XCTAssertNil(ByteArrayMapper.bytes(from: [NSNumber(value: 2.5)]))
    XCTAssertNil(ByteArrayMapper.bytes(from: [NSNumber(value: Double.nan)]))
    XCTAssertNil(ByteArrayMapper.bytes(from: [NSNumber(value: Double.infinity)]))
    XCTAssertNil(ByteArrayMapper.bytes(from: [NSNumber(value: -Double.infinity)]))
  }

  func testNumbersMirrorTheDataBytes() {
    XCTAssertEqual(ByteArrayMapper.numbers(from: Data([0x02, 0x9A, 0x1C, 0x00, 0xFF])), [2, 154, 28, 0, 255])
    XCTAssertEqual(ByteArrayMapper.numbers(from: Data()), [])
  }

  func testBytesAndNumbersRoundTrip() {
    let original: [NSNumber] = [0, 17, 128, 255]
    let bytes = ByteArrayMapper.bytes(from: original)
    XCTAssertEqual(ByteArrayMapper.numbers(from: Data(bytes ?? [])), original)
  }
}
