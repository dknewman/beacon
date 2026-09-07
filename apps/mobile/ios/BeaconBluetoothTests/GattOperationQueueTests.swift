import XCTest

@testable import Beacon

final class GattOperationQueueTests: XCTestCase {

  func testRunsOneOperationAtATimeInOrder() {
    let queue = GattOperationQueue()
    var started: [String] = []
    queue.enqueue(.init(label: "a") { started.append("a"); return true })
    queue.enqueue(.init(label: "b") { started.append("b"); return true })
    queue.enqueue(.init(label: "c") { started.append("c"); return true })

    XCTAssertEqual(started, ["a"])
    XCTAssertTrue(queue.isBusy)
    XCTAssertEqual(queue.depth, 3)

    queue.finish()
    XCTAssertEqual(started, ["a", "b"])
    queue.finish()
    XCTAssertEqual(started, ["a", "b", "c"])
    queue.finish()
    XCTAssertFalse(queue.isBusy)
    XCTAssertEqual(queue.depth, 0)
  }

  func testAnOperationThatFailsToStartDoesNotBlockTheNext() {
    let queue = GattOperationQueue()
    var started: [String] = []
    queue.enqueue(.init(label: "bad") { started.append("bad"); return false })
    queue.enqueue(.init(label: "good") { started.append("good"); return true })
    XCTAssertEqual(started, ["bad", "good"])
    XCTAssertEqual(queue.current?.label, "good")
  }

  func testCancelAllReturnsInFlightAndPendingOperations() {
    let queue = GattOperationQueue()
    queue.enqueue(.init(label: "a") { true })
    queue.enqueue(.init(label: "b") { true })
    queue.enqueue(.init(label: "c") { true })
    let cancelled = queue.cancelAll()
    XCTAssertEqual(cancelled.map(\.label), ["a", "b", "c"])
    XCTAssertFalse(queue.isBusy)
    XCTAssertEqual(queue.depth, 0)
    XCTAssertEqual(queue.cancelAll().count, 0)
  }

  func testFinishWhileIdleIsHarmless() {
    let queue = GattOperationQueue()
    queue.finish()
    XCTAssertFalse(queue.isBusy)
    var ran = false
    queue.enqueue(.init(label: "a") { ran = true; return true })
    XCTAssertTrue(ran)
  }
}
