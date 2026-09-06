import CoreBluetooth
import Foundation

/// Owns the `CBCentralManager` and is the single source of truth for adapter state and scanning
/// on iOS.
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

  /// Called for each throttled advertisement with a `DiscoveredPeripheral.payload`.
  @objc public var onDeviceDiscovered: (([String: Any]) -> Void)?

  /// Called for asynchronous failures with a `BleError.payload` (no `deviceId` in M2).
  @objc public var onError: (([String: Any]) -> Void)?

  private let queue = DispatchQueue(label: "com.beacon.bluetooth.central", qos: .userInitiated)
  private lazy var centralDelegate = CentralDelegateProxy(owner: self)
  private var central: CBCentralManager?
  private var hasReceivedInitialState = false
  private var pendingStateRequests: [(String) -> Void] = []
  private var pendingAuthorizationRequests: [(String) -> Void] = []
  private var pendingScanStarts: [() -> Void] = []
  private var isInvalidated = false

  /// Scan bookkeeping. `isScanning` mirrors what this manager asked CoreBluetooth to do;
  /// CoreBluetooth silently stops scanning when the radio leaves `.poweredOn`.
  private var isScanning = false
  private var lastReportedAt: [UUID: Date] = [:]

  /// Minimum spacing between two discovery events for the same peripheral. Real peripherals
  /// advertise every 20 ms to 1 s; the list only needs a few updates per second.
  private let discoveryThrottle: TimeInterval = 0.3

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

  /// Starts scanning. Completes with `nil` on success or a `BleError.payload` dictionary.
  ///
  /// `serviceUuids` may use 16-bit, 32-bit or 128-bit forms; an empty list scans for every
  /// peripheral. `allowDuplicates` asks CoreBluetooth for repeated advertisements (needed for
  /// RSSI updates); they are throttled per peripheral before reaching JavaScript.
  @objc public func startScan(
    _ serviceUuids: [String],
    allowDuplicates: Bool,
    completion: @escaping ([String: Any]?) -> Void
  ) {
    queue.async { [self] in
      guard !isInvalidated else {
        completion(BleError(code: .nativeFailure, message: "Bluetooth module has been invalidated").payload)
        return
      }
      switch CBManager.authorization {
      case .notDetermined:
        completion(BleError(code: .permissionDenied, message: "Bluetooth permission has not been requested").payload)
        return
      case .denied, .restricted:
        completion(BleError(code: .permissionDenied, message: "Bluetooth permission was denied").payload)
        return
      case .allowedAlways:
        break
      @unknown default:
        break
      }

      var uuids: [CBUUID] = []
      for value in serviceUuids {
        guard let uuid = AdvertisementMapper.parseServiceUuid(value) else {
          completion(BleError(code: .scanFailed, message: "Invalid service UUID: \(value)").payload)
          return
        }
        uuids.append(uuid)
      }

      let central = ensureCentral()
      let begin = { [weak self] in
        guard let self else { return }
        completion(self.beginScan(on: central, serviceUuids: uuids, allowDuplicates: allowDuplicates))
      }
      if hasReceivedInitialState {
        begin()
        return
      }
      pendingScanStarts.append(begin)
      queue.asyncAfter(deadline: .now() + initialStateTimeout) { [weak self] in
        self?.flushPendingScanStarts(onlyIfStillWaiting: true)
      }
    }
  }

  /// Stops scanning. Completes with `nil` even when no scan was running.
  @objc public func stopScan(_ completion: @escaping ([String: Any]?) -> Void) {
    queue.async { [self] in
      endScan()
      completion(nil)
    }
  }

  /// Releases CoreBluetooth resources. Called when the React instance is torn down.
  @objc public func invalidate() {
    queue.async { [self] in
      isInvalidated = true
      endScan()
      central?.delegate = nil
      central = nil
      flushPendingRequests(with: .unknown, onlyIfStillWaiting: false)
      flushPendingAuthorizationRequests()
      flushPendingScanStarts(onlyIfStillWaiting: false)
      onStateChanged = nil
      onDeviceDiscovered = nil
      onError = nil
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

  /// Runs on the queue once the adapter state is known. Returns nil on success.
  private func beginScan(
    on central: CBCentralManager,
    serviceUuids: [CBUUID],
    allowDuplicates: Bool
  ) -> [String: Any]? {
    guard !isInvalidated else {
      return BleError(code: .nativeFailure, message: "Bluetooth module has been invalidated").payload
    }
    switch central.state {
    case .poweredOn:
      break
    case .poweredOff:
      return BleError(code: .bluetoothPoweredOff, message: "Bluetooth is powered off").payload
    case .unsupported:
      return BleError(code: .bluetoothUnsupported, message: "This device does not support Bluetooth Low Energy").payload
    case .unauthorized:
      return BleError(code: .permissionDenied, message: "Bluetooth permission was denied").payload
    case .resetting:
      return BleError(code: .nativeFailure, message: "The Bluetooth system is resetting").payload
    case .unknown:
      return BleError(code: .nativeFailure, message: "Bluetooth state is not known yet").payload
    @unknown default:
      return BleError(code: .nativeFailure, message: "Unrecognized Bluetooth state").payload
    }
    if isScanning {
      return nil
    }
    lastReportedAt.removeAll()
    isScanning = true
    central.scanForPeripherals(
      withServices: serviceUuids.isEmpty ? nil : serviceUuids,
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: allowDuplicates]
    )
    return nil
  }

  private func endScan() {
    if isScanning, let central, central.state == .poweredOn {
      central.stopScan()
    }
    isScanning = false
    lastReportedAt.removeAll()
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

  private func flushPendingScanStarts(onlyIfStillWaiting: Bool) {
    if onlyIfStillWaiting, hasReceivedInitialState {
      return
    }
    let starts = pendingScanStarts
    pendingScanStarts.removeAll()
    starts.forEach { $0() }
  }

  fileprivate func handleCentralStateUpdate(_ central: CBCentralManager) {
    guard !isInvalidated else { return }
    let state = BluetoothStateMapper.map(central.state)
    hasReceivedInitialState = true
    if state != .poweredOn, isScanning {
      // CoreBluetooth has already dropped the scan; JavaScript sees the adapter event,
      // stops the coordinator, and restarts explicitly when the user asks again.
      isScanning = false
      lastReportedAt.removeAll()
    }
    flushPendingRequests(with: state, onlyIfStillWaiting: false)
    if CBManager.authorization != .notDetermined {
      flushPendingAuthorizationRequests()
    }
    flushPendingScanStarts(onlyIfStillWaiting: false)
    onStateChanged?(state.rawValue)
  }

  fileprivate func handleDiscovery(
    _ peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi: NSNumber
  ) {
    guard isScanning, !isInvalidated else { return }
    let now = Date()
    if let last = lastReportedAt[peripheral.identifier], now.timeIntervalSince(last) < discoveryThrottle {
      return
    }
    lastReportedAt[peripheral.identifier] = now
    let device = AdvertisementMapper.map(
      identifier: peripheral.identifier,
      peripheralName: peripheral.name,
      advertisementData: advertisementData,
      rssi: rssi,
      seenAt: now
    )
    onDeviceDiscovered?(device.payload)
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

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    owner.handleDiscovery(peripheral, advertisementData: advertisementData, rssi: RSSI)
  }
}
