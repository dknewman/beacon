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
}

/// The subset of `BluetoothManager` a session's delegate proxy calls back into.
protocol PeripheralSessionOwner: AnyObject {
  func session(_ session: PeripheralSession, didDiscoverServices error: Error?)
  func session(_ session: PeripheralSession, didDiscoverCharacteristicsFor service: CBService, error: Error?)
  func session(_ session: PeripheralSession, didReadRSSI rssi: NSNumber, error: Error?)
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
}
