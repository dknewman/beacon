# Native Bridge

Beacon uses a React Native **Turbo Native Module** generated from a TypeScript spec. The bridge
is deliberately narrow: primitives, plain objects, promises and typed event emitters only. All
domain typing and validation happen on the JavaScript side.

## Spec

`apps/mobile/src/native/specs/NativeBeaconBluetooth.ts`

```ts
export interface Spec extends TurboModule {
  getBluetoothState(): Promise<string>;
  getPermissionState(): Promise<string>;
  requestPermission(): Promise<string>;
  startScan(serviceUuids: string[], allowDuplicates: boolean): Promise<void>;
  stopScan(): Promise<void>;
  readonly onBluetoothStateChanged: CodegenTypes.EventEmitter<{ state: string }>;
  readonly onDeviceDiscovered: CodegenTypes.EventEmitter<DeviceDiscoveredEvent>; // BleDevice shape
  readonly onBleError: CodegenTypes.EventEmitter<{
    deviceId?: string;
    error: BleErrorPayload;
  }>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('BeaconBluetooth');
```

Codegen configuration lives in `apps/mobile/package.json` (`codegenConfig`). The iOS module is
registered through `ios.modulesProvider`; the Android module is registered manually in
`MainApplication.kt` via `BeaconBluetoothPackage`.

Generated artifacts (never committed):

- iOS: `ios/build/generated/ios/ReactCodegen/BeaconBluetoothSpec/BeaconBluetoothSpec.h` defines
  `NativeBeaconBluetoothSpec` (protocol), `NativeBeaconBluetoothSpecBase` (event emitter base
  class) and `NativeBeaconBluetoothSpecJSI`.
- Android: `com.beacon.bluetooth.spec.NativeBeaconBluetoothSpec` (abstract class with one
  `Promise` method per spec method and one `emitOn…(ReadableMap)` per emitter). The package
  comes from `codegenConfig.android.javaPackageName`, which the Gradle plugin honors.

Scalar parameters are chosen over object parameters (`startScan(serviceUuids, allowDuplicates)`
rather than `startScan(options)`) because arrays and primitives map to plain `NSArray`/`BOOL` and
`ReadableArray`/`Boolean`, whereas object parameters generate C++ struct wrappers on iOS.

The iOS and Android builds run codegen automatically. The standalone
`react-native codegen` command also works for inspection, but note that it ignores
`javaPackageName` for app projects and emits the Android spec under `com.facebook.fbreact.specs`;
the Gradle build is the source of truth.

## iOS

```text
BeaconBluetoothModule.mm  (Objective-C++)  — conforms to the generated spec, forwards to Swift
BluetoothManager.swift                     — owns CBCentralManager; adapter state, permission, scanning, connections
PeripheralSession.swift                    — one CBPeripheral + private CBPeripheralDelegate proxy, pending completions
Mapping/BluetoothStateMapper.swift         — CBManagerState → wire value
Mapping/ConnectionStateMapper.swift        — BleConnectionState wire vocabulary, CBPeripheralState mapping
Mapping/GattMapper.swift                   — CBService/CBCharacteristic → GattService payloads, property option set → wire values
Mapping/AuthorizationMapper.swift          — CBManagerAuthorization → wire value
Mapping/AdvertisementMapper.swift          — discovery callback → BleDevice payload, UUID parsing
Errors/BleError.swift                      — CoreBluetooth errors → contract codes
```

The Objective-C++ file is required because the generated spec is C++-aware; it is intentionally
free of Bluetooth logic. Swift is exposed through the Xcode-generated `Beacon-Swift.h` using
`@objc(BeaconBluetoothManager)`.

Threading: CoreBluetooth callbacks arrive on a private serial queue. The codegen event emitter is
thread safe, so events are emitted from that queue directly.

Void promises: Swift completes with `nil` on success or a `BleError.payload` dictionary; the
shim's `settle:resolve:reject:` turns the dictionary into `reject(code, message, NSError)` so
JavaScript's `toBleError` reads the contract code.

Connections: `connect` retains the `CBPeripheral` (from the scan cache or
`retrievePeripherals(withIdentifiers:)`), calls `connect`, then `discoverServices(nil)` after
`didConnect`, discovers each service's characteristics, and completes at `ready` once the last
`didDiscoverCharacteristicsFor` arrives. The mapped table is cached on the session and served by
`discoverServices`; a discovery error closes the link after emitting the error. `didFailToConnect` / `didDisconnectPeripheral` emit the
error (with `deviceId`) before the `disconnected` transition unless JavaScript asked for the
disconnect. Cancelling a pending attempt is settled locally because CoreBluetooth does not
promise a callback for it.

## Android

```text
BeaconBluetoothModule.kt   — extends generated NativeBeaconBluetoothSpec, module lifecycle
BeaconBluetoothPackage.kt  — BaseReactPackage registration (isTurboModule = true)
BluetoothController.kt     — BluetoothManager/BluetoothAdapter, ACTION_STATE_CHANGED receiver
scanning/BleScanner.kt     — BluetoothLeScanner, pre-flight checks, throttling, onScanFailed
connection/ConnectionRegistry.kt — one DeviceConnection per address, shared pre-flight checks
connection/DeviceConnection.kt   — BluetoothGatt + BluetoothGattCallback, state machine, pending promises
permissions/*              — runtime permission flow (see PERMISSIONS.md)
mapping/BluetoothStateMapper.kt, ConnectionStateMapper.kt, GattStatusMapper.kt, GattTreeMapper.kt, ScanResultMapper.kt, BleUuid.kt, ScanFailureMapper.kt, IsoTimestamp.kt
errors/BleError.kt         — contract codes, Promise.rejectWith, Throwable.toBleError
```

`initialize()` starts the broadcast receiver and `invalidate()` stops it, any scan and every
connection (`BluetoothGatt.close()`), so nothing leaks across React instance reloads.
`DeviceConnection` guards its state with the instance lock because `BluetoothGattCallback`
runs on a binder thread; `GattStatusMapper` turns status codes (133, 8, 19, 22, 62) into
contract errors with the platform status kept in `nativeCode`. Android delivers the complete
tree in `onServicesDiscovered`; `GattTreeMapper` snapshots it (property bitmask → wire values,
uppercase UUIDs) and `discoverServices` serves the snapshot while the link is READY. Events are emitted only once the
TurboModule infrastructure has bound the emitter callback. When the adapter leaves `STATE_ON`
the module forgets the scan (the platform has already dropped it) so the next `startScan` is a
real start.

## JavaScript wrapper

`apps/mobile/src/native/createNativeBleClient.ts` implements `BleClient`
(`BluetoothAdapterApi & PermissionApi & ScanApi`):

- Value-returning calls validate the result (`parseBluetoothState`, `parseBlePermissionState`);
  invalid values reject with `BleError("invalid_payload")`; native rejections are mapped with
  `toBleError` and default to `native_failure`.
- `startScan(options)` fills explicit defaults (`[]`, `false`) before crossing the bridge;
  `stopScan()` never throws for "not scanning".
- `connect` rejections default to `connection_failed`; `readRssi` results are range-checked
  (`parseRssi`), so a bogus 127 from a platform becomes `invalid_payload`.
- `discoverServices` results are validated with `parseGattServices`: every UUID is normalized
  to canonical form and every property must be a `CharacteristicProperty`.
- `subscribe()` folds the four typed emitters into the `NativeBleEvent` union, validates each
  payload (`scan.device_discovered` also normalizes UUIDs), and returns one unsubscribe function
  that removes every native subscription.

## Error convention

Native rejects promises with `code` set to a `BleErrorCode` wire value and the message as a
human readable string. Android additionally passes `nativeCode`/`nativeDomain` through the
rejection `userInfo`. JavaScript reads `code` in `toBleError`.

## Extending the bridge

1. Add the method or emitter to the spec using codegen-compatible types.
2. Add the matching segment implementation to the contract wrapper and validate its payloads.
3. Implement in Swift (`BluetoothManager` or a new `PeripheralSession`) and expose through the
   `.mm` shim.
4. Implement in Kotlin (`BluetoothController` / `DeviceConnection`) and override in the module.
5. Add JS tests with a fake spec, plus XCTest and JUnit tests for pure mapping logic.
