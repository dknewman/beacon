import XCTest

@testable import Beacon

final class ExportFileStoreTests: XCTestCase {

  /// A directory of its own per test, so a leftover file from one test cannot make another
  /// pass or fail. Nothing here touches the store's real `<tmp>/beacon-exports`.
  private var directory: URL!
  private var store: ExportFileStore!

  override func setUp() {
    super.setUp()
    directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
      .appendingPathComponent("beacon-export-tests-\(UUID().uuidString)", isDirectory: true)
    store = ExportFileStore(directory: directory)
  }

  override func tearDown() {
    try? FileManager.default.removeItem(at: directory)
    store = nil
    directory = nil
    super.tearDown()
  }

  func testWritingCreatesTheDirectoryAndRoundTripsTheContentsAsUtf8() throws {
    let contents = "{\"session\":\"café ☕\"}"
    let url = try store.write(fileName: "session.json", contents: contents)

    XCTAssertEqual(url.path, directory.appendingPathComponent("session.json").path)
    XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    let data = try Data(contentsOf: url)
    XCTAssertEqual(String(data: data, encoding: .utf8), contents)
  }

  func testWritingTheSameNameTwiceReplacesTheFile() throws {
    _ = try store.write(fileName: "session.json", contents: "first")
    let url = try store.write(fileName: "session.json", contents: "second")

    XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), "second")
    let entries = try FileManager.default.contentsOfDirectory(atPath: directory.path)
    XCTAssertEqual(entries, ["session.json"])
  }

  func testAFileNameWithDirectoryPartsIsReducedToItsLastComponent() throws {
    let traversal = try store.write(fileName: "../../session.json", contents: "x")
    XCTAssertEqual(traversal.path, directory.appendingPathComponent("session.json").path)

    let absolute = try store.write(fileName: "/etc/passwd", contents: "x")
    XCTAssertEqual(absolute.path, directory.appendingPathComponent("passwd").path)
  }

  func testAFileNameThatReducesToNothingUsableIsRejected() {
    for fileName in ["", "/", ".", "..", "../", "a/.."] {
      XCTAssertThrowsError(try store.write(fileName: fileName, contents: "x")) { error in
        guard let exportError = error as? ExportError else {
          XCTFail("expected an ExportError for \"\(fileName)\"")
          return
        }
        XCTAssertEqual(exportError.code, .writeFailed, "for \"\(fileName)\"")
      }
    }
  }

  func testContainsAcceptsAFileTheStoreWrote() throws {
    let url = try store.write(fileName: "session.csv", contents: "a,b")
    XCTAssertTrue(store.contains(path: url.path))
  }

  func testContainsRejectsPathsOutsideTheDirectory() {
    XCTAssertFalse(store.contains(path: "/etc/passwd"))
    // The directory itself is not a file in the directory.
    XCTAssertFalse(store.contains(path: directory.path))
    // A sibling whose name merely starts with ours must not pass a prefix comparison.
    XCTAssertFalse(store.contains(path: directory.path + "-other/session.json"))
  }

  func testContainsRejectsATraversalOutOfTheDirectory() {
    XCTAssertFalse(store.contains(path: directory.path + "/../session.json"))
    XCTAssertFalse(store.contains(path: directory.path + "/nested/../../session.json"))
  }

  func testClearRemovesFilesReturnsTheCountAndIsSafeToCallTwice() throws {
    _ = try store.write(fileName: "one.json", contents: "1")
    _ = try store.write(fileName: "two.json", contents: "2")

    XCTAssertEqual(store.clear(), 2)
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
    XCTAssertEqual(store.clear(), 0)
  }

  func testClearOnADirectoryThatWasNeverCreatedRemovesNothing() {
    let untouched = ExportFileStore(
      directory: directory.appendingPathComponent("never-written", isDirectory: true)
    )
    XCTAssertEqual(untouched.clear(), 0)
  }
}
