import CoreBluetooth
import Foundation

/// Owns the `CBCentralManager` and is the single source of truth for adapter state, scanning
/// and connections on iOS (PROJECT.md 27).
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

  /// Called for every connection transition with the device id and `BleConnectionState.rawValue`.
  @objc public var onConnectionStateChanged: ((String, String) -> Void)?

  /// Called for asynchronous failures with an optional device id and a `BleError.payload`.
  /// Device errors are always sent before the `disconnected` transition they cause.
  @objc public var onError: ((String?, [String: Any]) -> Void)?

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

  /// Peripherals seen by the scanner, retained so they can be connected later. CoreBluetooth
  /// only keeps a `CBPeripheral` alive while something references it.
  private var discoveredPeripherals: [UUID: CBPeripheral] = [:]

  /// One session per peripheral that has been connected or is connecting.
  private var sessions: [UUID: PeripheralSession] = [:]

  /// Minimum spacing between two discovery events for the same peripheral. Real peripherals
  /// advertise every 20 ms to 1 s; the list only needs a few updates per second.
  private let discoveryThrottle: TimeInterval = 0.3

  /// Upper bound on how long a state request may wait for `centralManagerDidUpdateState`.
  /// CoreBluetooth reports promptly; this only guarantees the JS promise always settles.
  private let initialStateTimeout: DispatchTimeInterval = .seconds(3)

  // MARK: - Adapter state and permission

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

  // MARK: - Scanning

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
      if let error = authorizationError() {
        completion(error.payload)
        return
      }

      var uuids: [CBUUID] = []
      for value in serviceUuids {
        guard let uuid = AdvertisementMapper.parseServiceUuid(value) else {
          completion(BleError(code: .scanFailed, message: "Invalid service UUID: \(value)").payload)
          return
        }
        uuids.append(uuid)
      }

      whenAdapterStateKnown { [weak self] central in
        guard let self else { return }
        completion(self.beginScan(on: central, serviceUuids: uuids, allowDuplicates: allowDuplicates))
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

  // MARK: - Connections

  /// Connects to a peripheral and discovers its services. Completes with `nil` once the
  /// session is `ready`, or with a `BleError.payload`. A second call while an attempt is in
  /// progress joins it; a call on a ready session completes immediately.
  @objc public func connect(_ deviceId: String, completion: @escaping ([String: Any]?) -> Void) {
    queue.async { [self] in
      if let error = authorizationError() {
        completion(error.payload)
        return
      }
      guard let uuid = UUID(uuidString: deviceId) else {
        completion(BleError(code: .deviceNotFound, message: "Not a peripheral identifier: \(deviceId)").payload)
        return
      }
      whenAdapterStateKnown { [weak self] central in
        guard let self else { return }
        if let error = self.radioError(for: central) {
          completion(error.payload)
          return
        }
        guard let session = self.session(for: uuid, central: central) else {
          completion(BleError(code: .deviceNotFound, message: "No peripheral with identifier \(deviceId)").payload)
          return
        }
        switch session.state {
        case .ready:
          completion(nil)
        case .connecting, .connected, .discoveringServices:
          session.pendingConnects.append(completion)
        case .disconnecting:
          completion(BleError(code: .connectionFailed, message: "The peripheral is still disconnecting").payload)
        case .disconnected, .failed:
          session.disconnectRequested = false
          session.pendingConnects.append(completion)
          self.transition(session, to: .connecting)
          central.connect(session.peripheral, options: nil)
        }
      }
    }
  }

  /// Disconnects, or cancels an attempt in progress. Completes once the link is gone; completes
  /// immediately when there is no session or it is already disconnected.
  @objc public func disconnect(_ deviceId: String, completion: @escaping () -> Void) {
    queue.async { [self] in
      guard let uuid = UUID(uuidString: deviceId), let session = sessions[uuid],
        session.state != .disconnected, session.state != .failed
      else {
        completion()
        return
      }
      session.pendingDisconnects.append(completion)
      session.disconnectRequested = true
      if session.state == .disconnecting {
        return
      }
      if session.state == .connecting {
        // CoreBluetooth does not promise a delegate callback for a cancelled pending
        // connection, so the cancellation is reported here and a late callback is a no-op.
        central?.cancelPeripheralConnection(session.peripheral)
        finish(session, error: nil)
        return
      }
      transition(session, to: .disconnecting)
      central?.cancelPeripheralConnection(session.peripheral)
    }
  }

  /// Reads the RSSI of a connected peripheral. Completes with the value or a `BleError.payload`.
  @objc public func readRssi(
    _ deviceId: String,
    completion: @escaping (NSNumber?, [String: Any]?) -> Void
  ) {
    queue.async { [self] in
      guard let uuid = UUID(uuidString: deviceId), let session = sessions[uuid],
        session.peripheral.state == .connected
      else {
        completion(nil, BleError(code: .disconnected, message: "Not connected to \(deviceId)").payload)
        return
      }
      let wasIdle = session.pendingRssiReads.isEmpty
      session.pendingRssiReads.append(completion)
      if wasIdle {
        session.peripheral.readRSSI()
      }
    }
  }

  /// Returns the GATT table discovered while connecting. Completes with the service payloads,
  /// or a `BleError.payload` (`disconnected`) when the session is not `ready`.
  @objc public func discoverServices(
    _ deviceId: String,
    completion: @escaping ([[String: Any]]?, [String: Any]?) -> Void
  ) {
    queue.async { [self] in
      guard let uuid = UUID(uuidString: deviceId), let session = sessions[uuid],
        session.state == .ready
      else {
        completion(nil, BleError(code: .disconnected, message: "Not connected to \(deviceId)").payload)
        return
      }
      completion(session.services.map(\.payload), nil)
    }
  }

  // MARK: - Characteristic reads and writes

  /// Reads a characteristic value. Completes with the unsigned bytes, or a `BleError.payload`
  /// (`disconnected`, `characteristic_not_found`, `read_failed`). Runs behind the peripheral's
  /// other GATT operations; CoreBluetooth answers through `didUpdateValueFor`.
  @objc public func readCharacteristic(
    _ deviceId: String,
    serviceUuid: String,
    characteristicUuid: String,
    completion: @escaping ([NSNumber]?, [String: Any]?) -> Void
  ) {
    queue.async { [self] in
      let target: GattTarget
      switch resolveCharacteristic(deviceId: deviceId, serviceUuid: serviceUuid, characteristicUuid: characteristicUuid) {
      case .success(let resolved):
        target = resolved
      case .failure(let error):
        completion(nil, error.payload)
        return
      }
      let characteristic = target.characteristic
      guard characteristic.properties.contains(.read) else {
        completion(nil, propertyError(code: .readFailed, message: "Read not permitted").payload)
        return
      }
      target.session.enqueue(label: "read \(characteristicUuid)", cancel: { completion(nil, $0.payload) }) { session in
        session.pendingRead = (characteristic, completion)
        session.peripheral.readValue(for: characteristic)
        return true
      }
    }
  }

  /// Writes unsigned bytes to a characteristic. Completes with `nil` on success or a
  /// `BleError.payload` (`invalid_payload`, `disconnected`, `characteristic_not_found`,
  /// `write_failed`). With `withResponse` the completion waits for the peripheral's
  /// acknowledgement; without it the bytes are handed to the stack and the call completes.
  @objc public func writeCharacteristic(
    _ deviceId: String,
    serviceUuid: String,
    characteristicUuid: String,
    bytes: [NSNumber],
    withResponse: Bool,
    completion: @escaping ([String: Any]?) -> Void
  ) {
    queue.async { [self] in
      guard let payload = ByteArrayMapper.bytes(from: bytes) else {
        completion(BleError(code: .invalidPayload, message: "Bytes must be whole numbers between 0 and 255").payload)
        return
      }
      let target: GattTarget
      switch resolveCharacteristic(deviceId: deviceId, serviceUuid: serviceUuid, characteristicUuid: characteristicUuid) {
      case .success(let resolved):
        target = resolved
      case .failure(let error):
        completion(error.payload)
        return
      }
      let characteristic = target.characteristic
      let required: CBCharacteristicProperties = withResponse ? .write : .writeWithoutResponse
      guard characteristic.properties.contains(required) else {
        completion(propertyError(code: .writeFailed, message: "Write not permitted").payload)
        return
      }
      let data = Data(payload)
      target.session.enqueue(label: "write \(characteristicUuid)", cancel: { completion($0.payload) }) { session in
        if withResponse {
          session.pendingWrite = (characteristic, completion)
          session.peripheral.writeValue(data, for: characteristic, type: .withResponse)
          return true
        }
        // CoreBluetooth sends no callback for this write type, so the operation is over as
        // soon as the bytes are handed to the stack and the queue may move on at once.
        // `canSendWriteWithoutResponse` back-pressure is not observed yet: a burst that
        // overruns the stack's buffer is dropped by CoreBluetooth rather than reported here.
        session.peripheral.writeValue(data, for: characteristic, type: .withoutResponse)
        completion(nil)
        return false
      }
    }
  }

  // MARK: - Lifecycle

  /// Releases CoreBluetooth resources. Called when the React instance is torn down.
  @objc public func invalidate() {
    queue.async { [self] in
      isInvalidated = true
      endScan()
      let invalidated = BleError(code: .disconnected, message: "Bluetooth module invalidated")
      for session in sessions.values {
        if session.peripheral.state != .disconnected {
          central?.cancelPeripheralConnection(session.peripheral)
        }
        session.detach()
        session.settleConnects(with: invalidated.payload)
        session.settleDisconnects()
        session.settleRssiReads(with: nil, error: invalidated.payload)
        session.cancelOperations(with: invalidated)
      }
      sessions.removeAll()
      discoveredPeripherals.removeAll()
      central?.delegate = nil
      central = nil
      flushPendingRequests(with: .unknown, onlyIfStillWaiting: false)
      flushPendingAuthorizationRequests()
      flushPendingScanStarts(onlyIfStillWaiting: false)
      onStateChanged = nil
      onDeviceDiscovered = nil
      onConnectionStateChanged = nil
      onError = nil
    }
  }

  // MARK: - Private: central

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

  /// Runs `body` once the adapter state is known, creating the central if needed. Times out
  /// like `getBluetoothState` so every caller settles.
  private func whenAdapterStateKnown(_ body: @escaping (CBCentralManager) -> Void) {
    let central = ensureCentral()
    if hasReceivedInitialState {
      body(central)
      return
    }
    pendingScanStarts.append { body(central) }
    queue.asyncAfter(deadline: .now() + initialStateTimeout) { [weak self] in
      self?.flushPendingScanStarts(onlyIfStillWaiting: true)
    }
  }

  private func authorizationError() -> BleError? {
    guard !isInvalidated else {
      return BleError(code: .nativeFailure, message: "Bluetooth module has been invalidated")
    }
    switch CBManager.authorization {
    case .notDetermined:
      return BleError(code: .permissionDenied, message: "Bluetooth permission has not been requested")
    case .denied, .restricted:
      return BleError(code: .permissionDenied, message: "Bluetooth permission was denied")
    case .allowedAlways:
      return nil
    @unknown default:
      return nil
    }
  }

  /// Why the radio cannot be used right now, or nil when it is powered on.
  private func radioError(for central: CBCentralManager) -> BleError? {
    guard !isInvalidated else {
      return BleError(code: .nativeFailure, message: "Bluetooth module has been invalidated")
    }
    switch central.state {
    case .poweredOn:
      return nil
    case .poweredOff:
      return BleError(code: .bluetoothPoweredOff, message: "Bluetooth is powered off")
    case .unsupported:
      return BleError(code: .bluetoothUnsupported, message: "This device does not support Bluetooth Low Energy")
    case .unauthorized:
      return BleError(code: .permissionDenied, message: "Bluetooth permission was denied")
    case .resetting:
      return BleError(code: .nativeFailure, message: "The Bluetooth system is resetting")
    case .unknown:
      return BleError(code: .nativeFailure, message: "Bluetooth state is not known yet")
    @unknown default:
      return BleError(code: .nativeFailure, message: "Unrecognized Bluetooth state")
    }
  }

  // MARK: - Private: scanning

  /// Runs on the queue once the adapter state is known. Returns nil on success.
  private func beginScan(
    on central: CBCentralManager,
    serviceUuids: [CBUUID],
    allowDuplicates: Bool
  ) -> [String: Any]? {
    if let error = radioError(for: central) {
      return error.payload
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

  // MARK: - Private: sessions

  private func session(for uuid: UUID, central: CBCentralManager) -> PeripheralSession? {
    if let existing = sessions[uuid] {
      return existing
    }
    let peripheral = discoveredPeripherals[uuid]
      ?? central.retrievePeripherals(withIdentifiers: [uuid]).first
    guard let peripheral else { return nil }
    let session = PeripheralSession(peripheral: peripheral)
    session.attach(owner: self)
    sessions[uuid] = session
    return session
  }

  private func transition(_ session: PeripheralSession, to state: BleConnectionState) {
    guard session.transition(to: state) else { return }
    onConnectionStateChanged?(session.peripheral.identifier.uuidString, state.rawValue)
  }

  private func emitError(_ error: BleError, for session: PeripheralSession) {
    onError?(session.peripheral.identifier.uuidString, error.payload)
  }

  /// Ends a session. A non-nil `error` is a failure or remote disconnect and is emitted before
  /// the `disconnected` transition; nil is a disconnect JavaScript asked for.
  private func finish(_ session: PeripheralSession, error: BleError?) {
    if let error {
      emitError(error, for: session)
      session.settleConnects(with: error.payload)
    } else {
      session.settleConnects(with: BleError(code: .disconnected, message: "Connection cancelled").payload)
    }
    let ended = BleError(code: .disconnected, message: "The connection ended")
    session.settleRssiReads(with: nil, error: ended.payload)
    session.cancelOperations(with: ended)
    session.disconnectRequested = false
    session.services = []
    session.pendingCharacteristicDiscoveries = 0
    transition(session, to: .disconnected)
    session.settleDisconnects()
  }

  private func dropAllSessions(reason: BleError) {
    for session in sessions.values where session.state != .disconnected {
      finish(session, error: reason)
    }
  }

  // MARK: - Private: GATT targets

  /// What a read or write addresses once its arguments have been checked.
  private typealias GattTarget = (session: PeripheralSession, characteristic: CBCharacteristic)

  /// The session and characteristic a read or write addresses, or why it cannot proceed:
  /// `disconnected` unless the session is `ready`, `characteristic_not_found` otherwise.
  private func resolveCharacteristic(
    deviceId: String,
    serviceUuid: String,
    characteristicUuid: String
  ) -> Result<GattTarget, BleError> {
    guard let uuid = UUID(uuidString: deviceId), let session = sessions[uuid], session.state == .ready else {
      return .failure(BleError(code: .disconnected, message: "Not connected to \(deviceId)"))
    }
    guard let characteristic = session.characteristic(serviceUuid: serviceUuid, characteristicUuid: characteristicUuid)
    else {
      return .failure(BleError(
        code: .characteristicNotFound,
        message: "No characteristic \(characteristicUuid) in service \(serviceUuid)"
      ))
    }
    return .success((session, characteristic))
  }

  /// The error for an operation the characteristic's properties do not allow. The domain
  /// tells developer mode the refusal came from the GATT table rather than the radio.
  private func propertyError(code: BleErrorCode, message: String) -> BleError {
    BleError(code: code, message: message, nativeDomain: "CBCharacteristicProperties")
  }

  // MARK: - Private: pending completions

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

  // MARK: - Central delegate handling (on queue)

  fileprivate func handleCentralStateUpdate(_ central: CBCentralManager) {
    guard !isInvalidated else { return }
    let state = BluetoothStateMapper.map(central.state)
    hasReceivedInitialState = true
    if state != .poweredOn {
      if isScanning {
        // CoreBluetooth has already dropped the scan; JavaScript sees the adapter event,
        // stops the coordinator, and restarts explicitly when the user asks again.
        isScanning = false
        lastReportedAt.removeAll()
      }
      dropAllSessions(reason: BleError(code: .bluetoothPoweredOff, message: "Bluetooth is no longer available"))
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
    discoveredPeripherals[peripheral.identifier] = peripheral
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

  fileprivate func handleConnect(_ peripheral: CBPeripheral) {
    guard let session = sessions[peripheral.identifier], session.state == .connecting else { return }
    transition(session, to: .connected)
    transition(session, to: .discoveringServices)
    peripheral.discoverServices(nil)
  }

  fileprivate func handleFailToConnect(_ peripheral: CBPeripheral, error: Error?) {
    guard let session = sessions[peripheral.identifier], session.state != .disconnected else { return }
    let bleError = error.map { BleError.from($0, fallback: .connectionFailed) }
      ?? BleError(code: .connectionFailed, message: "The peripheral did not accept the connection")
    finish(session, error: bleError)
  }

  fileprivate func handleDisconnect(_ peripheral: CBPeripheral, error: Error?) {
    guard let session = sessions[peripheral.identifier], session.state != .disconnected else { return }
    if session.disconnectRequested {
      finish(session, error: nil)
      return
    }
    let bleError = error.map { BleError.from($0, fallback: .disconnected) }
      ?? BleError(code: .disconnected, message: "The peripheral closed the connection")
    finish(session, error: bleError)
  }
}

// MARK: - PeripheralSessionOwner (peripheral delegate callbacks, on queue)

extension BluetoothManager: PeripheralSessionOwner {
  func session(_ session: PeripheralSession, didDiscoverServices error: Error?) {
    guard session.state == .discoveringServices else { return }
    if let error {
      failDiscovery(session, error: BleError.from(error, fallback: .serviceNotFound))
      return
    }
    let services = session.peripheral.services ?? []
    if services.isEmpty {
      session.services = []
      transition(session, to: .ready)
      session.settleConnects(with: nil)
      return
    }
    // Characteristics arrive one service at a time; the session is ready once all are in.
    session.pendingCharacteristicDiscoveries = services.count
    for service in services {
      session.peripheral.discoverCharacteristics(nil, for: service)
    }
  }

  func session(
    _ session: PeripheralSession,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    guard session.state == .discoveringServices, session.pendingCharacteristicDiscoveries > 0 else { return }
    if let error {
      session.pendingCharacteristicDiscoveries = 0
      failDiscovery(session, error: BleError.from(error, fallback: .characteristicNotFound))
      return
    }
    session.pendingCharacteristicDiscoveries -= 1
    if session.pendingCharacteristicDiscoveries == 0 {
      session.services = GattMapper.services(session.peripheral.services ?? [])
      transition(session, to: .ready)
      session.settleConnects(with: nil)
    }
  }

  /// A link whose table cannot be read is useless: report the error, then close it cleanly.
  private func failDiscovery(_ session: PeripheralSession, error: BleError) {
    emitError(error, for: session)
    session.settleConnects(with: error.payload)
    session.disconnectRequested = true
    transition(session, to: .disconnecting)
    central?.cancelPeripheralConnection(session.peripheral)
  }

  func session(_ session: PeripheralSession, didReadRSSI rssi: NSNumber, error: Error?) {
    if let error {
      session.settleRssiReads(with: nil, error: BleError.from(error, fallback: .readFailed).payload)
    } else {
      session.settleRssiReads(with: rssi, error: nil)
    }
  }

  func session(
    _ session: PeripheralSession,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard let pending = session.pendingRead, sameCharacteristic(pending.characteristic, characteristic) else {
      // A value nobody asked for is a notification; subscriptions arrive with M6 and there
      // is no listener for them yet.
      return
    }
    session.pendingRead = nil
    if let error {
      pending.completion(nil, BleError.from(error, fallback: .readFailed).payload)
    } else {
      pending.completion(ByteArrayMapper.numbers(from: characteristic.value ?? Data()), nil)
    }
    session.operations.finish()
  }

  func session(
    _ session: PeripheralSession,
    didWriteValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard let pending = session.pendingWrite, sameCharacteristic(pending.characteristic, characteristic) else {
      return
    }
    session.pendingWrite = nil
    pending.completion(error.map { BleError.from($0, fallback: .writeFailed).payload })
    session.operations.finish()
  }

  /// Matches a delegate callback to the in-flight operation by UUIDs rather than object
  /// identity, so the pairing does not depend on CoreBluetooth reusing instances.
  private func sameCharacteristic(_ expected: CBCharacteristic, _ reported: CBCharacteristic) -> Bool {
    expected.uuid == reported.uuid && expected.service?.uuid == reported.service?.uuid
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

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    owner.handleConnect(peripheral)
  }

  func centralManager(
    _ central: CBCentralManager,
    didFailToConnect peripheral: CBPeripheral,
    error: Error?
  ) {
    owner.handleFailToConnect(peripheral, error: error)
  }

  func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    owner.handleDisconnect(peripheral, error: error)
  }
}
