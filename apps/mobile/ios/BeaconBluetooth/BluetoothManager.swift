import CoreBluetooth
import Foundation

/// Owns the `CBCentralManager` and is the single source of truth for adapter state on iOS.
///
/// Exposed to Objective-C++ (`BeaconBluetoothModule.mm`) so the Turbo Module can stay a thin
/// adapter. All CoreBluetooth work happens on a private serial queue; callbacks into the
/// bridge may arrive on that queue and the bridge is responsible for thread hopping if needed
/// (the codegen event emitter is thread safe).
///
/// The central manager is created lazily. On iOS, creating it triggers the system Bluetooth
/// permission prompt, so nothing is created until JavaScript actually asks for state.
@objc(BeaconBluetoothManager)
public final class BluetoothManager: NSObject {

  /// Called on every adapter state transition with the wire value (`BleAdapterState.rawValue`).
  @objc public var onStateChanged: ((String) -> Void)?

  private let queue = DispatchQueue(label: "com.beacon.bluetooth.central", qos: .userInitiated)
  private var central: CBCentralManager?
  private var hasReceivedInitialState = false
  private var pendingStateRequests: [(String) -> Void] = []
  private var isInvalidated = false

  /// Upper bound on how long a state request may wait for `centralManagerDidUpdateState`.
  /// CoreBluetooth reports promptly; this only guarantees the JS promise always settles.
  private let initialStateTimeout: DispatchTimeInterval = .seconds(3)

  /// Resolves with the current adapter state, waiting for CoreBluetooth's first state report
  /// if the central manager was just created.
  @objc public func getBluetoothState(_ completion: @escaping (String) -> Void) {
    queue.async { [self] in
      guard !isInvalidated else {
        completion(BleAdapterState.unknown.rawValue)
        return
      }
      let central = ensureCentral()
      if hasReceivedInitialState {
        completion(BluetoothStateMapper.map(central.state).rawValue)
        return
      }
      pendingStateRequests.append(completion)
      queue.asyncAfter(deadline: .now() + initialStateTimeout) { [weak self] in
        self?.flushPendingRequests(with: .unknown, onlyIfStillWaiting: true)
      }
    }
  }

  /// Releases CoreBluetooth resources. Called when the React instance is torn down.
  @objc public func invalidate() {
    queue.async { [self] in
      isInvalidated = true
      central?.delegate = nil
      central = nil
      flushPendingRequests(with: .unknown, onlyIfStillWaiting: false)
      onStateChanged = nil
    }
  }

  // MARK: - Private

  private func ensureCentral() -> CBCentralManager {
    if let central {
      return central
    }
    let created = CBCentralManager(
      delegate: self,
      queue: queue,
      options: [CBCentralManagerOptionShowPowerAlertKey: false]
    )
    central = created
    return created
  }

  private func flushPendingRequests(with state: BleAdapterState, onlyIfStillWaiting: Bool) {
    if onlyIfStillWaiting, hasReceivedInitialState {
      return
    }
    let requests = pendingStateRequests
    pendingStateRequests.removeAll()
    requests.forEach { $0(state.rawValue) }
  }
}

extension BluetoothManager: CBCentralManagerDelegate {
  public func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard !isInvalidated else { return }
    let state = BluetoothStateMapper.map(central.state)
    hasReceivedInitialState = true
    flushPendingRequests(with: state, onlyIfStillWaiting: false)
    onStateChanged?(state.rawValue)
  }
}
