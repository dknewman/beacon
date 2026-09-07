import Foundation

/// Serializes GATT operations for one peripheral (PROJECT.md 29). CoreBluetooth and the
/// Android stack both misbehave when a second read or write is issued before the first has
/// been answered, so every operation waits for its predecessor's completion callback.
///
/// Pure Swift with no CoreBluetooth dependency: `start` closures perform the platform call and
/// the owner calls `finish()` from the matching delegate callback. Unit tested.
final class GattOperationQueue {

  /// An operation: `start` performs the platform call. Returning false means nothing is left
  /// in flight, because the call failed to start or completed synchronously; the owner has
  /// already settled its completion and the queue moves on.
  struct Operation {
    let label: String
    let start: () -> Bool
  }

  private var pending: [Operation] = []
  private(set) var current: Operation?

  var isBusy: Bool { current != nil }
  var depth: Int { pending.count + (current == nil ? 0 : 1) }

  /// Queues an operation and starts it immediately when nothing is in flight.
  func enqueue(_ operation: Operation) {
    pending.append(operation)
    startNextIfIdle()
  }

  /// Called by the owner when the in-flight operation's callback arrived.
  func finish() {
    current = nil
    startNextIfIdle()
  }

  /// Drops every queued operation, e.g. when the link ends. Returns them so the owner can
  /// settle their completions with an error. The in-flight one is included first, if any.
  func cancelAll() -> [Operation] {
    var cancelled: [Operation] = []
    if let current {
      cancelled.append(current)
    }
    cancelled.append(contentsOf: pending)
    current = nil
    pending.removeAll()
    return cancelled
  }

  private func startNextIfIdle() {
    while current == nil, !pending.isEmpty {
      let next = pending.removeFirst()
      current = next
      if !next.start() {
        current = nil
      }
    }
  }
}
