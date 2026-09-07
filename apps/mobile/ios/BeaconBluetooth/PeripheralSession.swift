import CoreBluetooth
import Foundation

/// Everything `BluetoothManager` needs to know about one peripheral it has connected, or is
/// connecting, to (PROJECT.md 27). Owned and mutated only on the manager's serial queue.
///
/// The session keeps the `CBPeripheral` alive (CoreBluetooth drops connections whose
/// peripheral object is released) and acts as its delegate through a private proxy, so the
/// Objective-C-visible surface of the module never mentions `CBPeripheralDelegate`.
final class PeripheralSession {

  let peripheral: CBPeripheral
  private(set) var state: BleConnectionState = .disconnected

  /// Completions for `connect` calls waiting for `ready`.
  var pendingConnects: [([String: Any]?) -> Void] = []
  /// Completions for `disconnect` calls waiting for the platform's disconnect callback.
  var pendingDisconnects: [() -> Void] = []
  /// Completions for `readRSSI`, answered in order by `peripheral(_:didReadRSSI:error:)`.
  var pendingRssiReads: [(NSNumber?, [String: Any]?) -> Void] = []
  /// Set when JavaScript asked for the link to end, so the disconnect is reported cleanly.
  var disconnectRequested = false
  /// The GATT table, complete once every service's characteristics have been discovered.
  var services: [DiscoveredService] = []
  /// Services still waiting for `didDiscoverCharacteristicsFor` during connection setup.
  var pendingCharacteristicDiscoveries = 0

  /// Serializes reads and writes so CoreBluetooth is never asked for a second value before it
  /// has answered the first (PROJECT.md 29). Fed through `enqueue`, drained by the manager's
  /// delegate handlers calling `operations.finish()`.
  let operations = GattOperationQueue()
  /// The read CoreBluetooth is answering: set by its operation's `start`, cleared by
  /// `didUpdateValueFor`. At most one at a time because `operations` runs them one by one; the
  /// characteristic is kept so an unrelated value update cannot settle it.
  var pendingRead: (characteristic: CBCharacteristic, completion: ([NSNumber]?, [String: Any]?) -> Void)?
  /// The write-with-response CoreBluetooth is acknowledging; same lifecycle as `pendingRead`.
  var pendingWrite: (characteristic: CBCharacteristic, completion: ([String: Any]?) -> Void)?
  /// How to fail each operation still waiting in `operations`. An entry is removed the moment
  /// its operation starts (the completion then lives in `pendingRead` or `pendingWrite`), so
  /// whatever remains when the link ends is exactly the set of never-started operations.
  private var queuedSettlers: [(token: UUID, settle: (BleError) -> Void)] = []

  private let delegateProxy = PeripheralDelegateProxy()

  init(peripheral: CBPeripheral) {
    self.peripheral = peripheral
  }

  /// Wires the delegate; `owner` receives the callbacks. Called once by the manager.
  func attach(owner: PeripheralSessionOwner) {
    delegateProxy.owner = owner
    delegateProxy.session = self
    peripheral.delegate = delegateProxy
  }

  func detach() {
    peripheral.delegate = nil
    delegateProxy.owner = nil
    delegateProxy.session = nil
  }

  /// Applies a transition; returns false when the state is unchanged so callers skip the event.
  @discardableResult
  func transition(to next: BleConnectionState) -> Bool {
    guard next != state else { return false }
    state = next
    return true
  }

  /// Settles every waiting connect call. `nil` means success.
  func settleConnects(with error: [String: Any]?) {
    let completions = pendingConnects
    pendingConnects.removeAll()
    completions.forEach { $0(error) }
  }

  func settleDisconnects() {
    let completions = pendingDisconnects
    pendingDisconnects.removeAll()
    completions.forEach { $0() }
  }

  func settleRssiReads(with rssi: NSNumber?, error: [String: Any]?) {
    let completions = pendingRssiReads
    pendingRssiReads.removeAll()
    completions.forEach { $0(rssi, error) }
  }

  // MARK: - GATT operations

  /// Queues a read or write. When its turn comes, `start` performs the platform call and
  /// returns whether a delegate callback is now awaited; `cancel` settles the completion if
  /// the link ends before that. `start` receives the session as an argument so the closure
  /// does not have to capture it, which keeps the queue from retaining its owner.
  func enqueue(
    label: String,
    cancel: @escaping (BleError) -> Void,
    start: @escaping (PeripheralSession) -> Bool
  ) {
    let token = UUID()
    queuedSettlers.append((token: token, settle: cancel))
    operations.enqueue(.init(label: label) { [weak self] in
      guard let self else { return false }
      self.queuedSettlers.removeAll { $0.token == token }
      return start(self)
    })
  }

  /// Fails the in-flight operation and every queued one, e.g. when the link ends. Settles in
  /// queue order: the in-flight read or write first, then the operations that never started.
  func cancelOperations(with error: BleError) {
    _ = operations.cancelAll()
    let read = pendingRead
    let write = pendingWrite
    let queued = queuedSettlers
    pendingRead = nil
    pendingWrite = nil
    queuedSettlers.removeAll()
    read?.completion(nil, error.payload)
    write?.completion(error.payload)
    queued.forEach { $0.settle(error) }
  }

  /// Finds a discovered characteristic by UUID strings in any accepted form (short or full,
  /// either case). Compares canonical forms because CoreBluetooth abbreviates SIG UUIDs while
  /// JavaScript sends the 128-bit form.
  func characteristic(serviceUuid: String, characteristicUuid: String) -> CBCharacteristic? {
    guard let service = GattMapper.canonicalUuid(serviceUuid),
      let wanted = GattMapper.canonicalUuid(characteristicUuid)
    else { return nil }
    for candidate in peripheral.services ?? []
    where GattMapper.canonicalUuid(candidate.uuid.uuidString) == service {
      if let match = candidate.characteristics?.first(where: {
        GattMapper.canonicalUuid($0.uuid.uuidString) == wanted
      }) {
        return match
      }
    }
    return nil
  }
}

/// The subset of `BluetoothManager` a session's delegate proxy calls back into.
protocol PeripheralSessionOwner: AnyObject {
  func session(_ session: PeripheralSession, didDiscoverServices error: Error?)
  func session(_ session: PeripheralSession, didDiscoverCharacteristicsFor service: CBService, error: Error?)
  func session(_ session: PeripheralSession, didReadRSSI rssi: NSNumber, error: Error?)
  func session(_ session: PeripheralSession, didUpdateValueFor characteristic: CBCharacteristic, error: Error?)
  func session(_ session: PeripheralSession, didWriteValueFor characteristic: CBCharacteristic, error: Error?)
}

/// Receives `CBPeripheralDelegate` callbacks on behalf of a session. Private so
/// `Beacon-Swift.h` stays free of CoreBluetooth protocol references.
private final class PeripheralDelegateProxy: NSObject, CBPeripheralDelegate {
  weak var owner: PeripheralSessionOwner?
  weak var session: PeripheralSession?

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let session else { return }
    owner?.session(session, didDiscoverServices: error)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    guard let session else { return }
    owner?.session(session, didDiscoverCharacteristicsFor: service, error: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
    guard let session else { return }
    owner?.session(session, didReadRSSI: RSSI, error: error)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard let session else { return }
    owner?.session(session, didUpdateValueFor: characteristic, error: error)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didWriteValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard let session else { return }
    owner?.session(session, didWriteValueFor: characteristic, error: error)
  }
}
