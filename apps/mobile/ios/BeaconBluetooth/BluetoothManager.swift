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
  private lazy var centralDelegate = CentralDelegateProxy(owner: self)
  private var central: CBCentralManager?
  private var hasReceivedInitialState = false
  private var pendingStateRequests: [(String) -> Void] = []
  private var pendingAuthorizationRequests: [(String) -> Void] = []
  private var isInvalidated = false

  /// Upper bound on how long a state request may wait for `centralManagerDidUpdateState`.
  /// CoreBluetooth reports promptly; this only guarantees the JS promise always settles.
  private let initialStateTimeout: DispatchTimeInterval = .seconds(3)

  /// Resolves with the current adapter state, waiting for CoreBluetooth's first state report
  /// if the central manager was just created.
  ///
  /// Authorization gates this call: while the user has not answered the Bluetooth prompt,
  /// creating a central manager would show it, so the state is reported as `unknown` until
  /// `requestPermission` runs. A refused authorization is reported as `unauthorized` without
  /// touching CoreBluetooth at all.
  @objc public func getBluetoothState(_ completion: @escaping (String) -> Void) {
    queue.async { [self] in
      guard !isInvalidated else {
        completion(BleAdapterState.unknown.rawValue)
        return
      }
      switch CBManager.authorization {
      case .notDetermined:
        completion(BleAdapterState.unknown.rawValue)
        return
      case .denied, .restricted:
        completion(BleAdapterState.unauthorized.rawValue)
        return
      case .allowedAlways:
        break
      @unknown default:
        break
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

  /// Resolves with the current permission state. Never shows a prompt.
  @objc public func getPermissionState(_ completion: @escaping (String) -> Void) {
    queue.async {
      completion(AuthorizationMapper.map(CBManager.authorization).rawValue)
    }
  }

  /// Shows the system Bluetooth prompt when authorization is still undetermined and resolves
  /// once the user has answered. Resolves immediately with the current state otherwise.
  ///
  /// The prompt is a side effect of creating the first `CBCentralManager`; CoreBluetooth then
  /// delivers `centralManagerDidUpdateState` after the user's answer, which is where pending
  /// requests are completed. There is deliberately no timeout: the user may take as long as
  /// they like, and the JavaScript side shows a "requesting" state meanwhile.
  @objc public func requestPermission(_ completion: @escaping (String) -> Void) {
    queue.async { [self] in
      let current = AuthorizationMapper.map(CBManager.authorization)
      guard !isInvalidated, current == .notRequested else {
        completion(current.rawValue)
        return
      }
      pendingAuthorizationRequests.append(completion)
      _ = ensureCentral()
    }
  }

  /// Releases CoreBluetooth resources. Called when the React instance is torn down.
  @objc public func invalidate() {
    queue.async { [self] in
      isInvalidated = true
      central?.delegate = nil
      central = nil
      flushPendingRequests(with: .unknown, onlyIfStillWaiting: false)
      flushPendingAuthorizationRequests()
      onStateChanged = nil
    }
  }

  // MARK: - Private

  private func ensureCentral() -> CBCentralManager {
    if let central {
      return central
    }
    let created = CBCentralManager(
      delegate: centralDelegate,
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

  private func flushPendingAuthorizationRequests() {
    let requests = pendingAuthorizationRequests
    pendingAuthorizationRequests.removeAll()
    let state = AuthorizationMapper.map(CBManager.authorization).rawValue
    requests.forEach { $0(state) }
  }

  fileprivate func handleCentralStateUpdate(_ central: CBCentralManager) {
    guard !isInvalidated else { return }
    let state = BluetoothStateMapper.map(central.state)
    hasReceivedInitialState = true
    flushPendingRequests(with: state, onlyIfStillWaiting: false)
    if CBManager.authorization != .notDetermined {
      flushPendingAuthorizationRequests()
    }
    onStateChanged?(state.rawValue)
  }
}

/// Receives CoreBluetooth delegate callbacks on behalf of `BluetoothManager`.
///
/// Kept as a private class rather than an extension on the manager so that the
/// Objective-C-visible surface of `BluetoothManager` (and therefore the generated
/// `Beacon-Swift.h`) does not reference CoreBluetooth protocols. Objective-C++ importers of
/// that header would otherwise have to import CoreBluetooth themselves.
private final class CentralDelegateProxy: NSObject, CBCentralManagerDelegate {
  private unowned let owner: BluetoothManager

  init(owner: BluetoothManager) {
    self.owner = owner
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    owner.handleCentralStateUpdate(central)
  }
}
