# Native Bridge

Beacon uses React Native **Turbo Native Modules** generated from TypeScript specs. The bridge
is deliberately narrow: primitives, plain objects, promises and typed event emitters only. All
domain typing and validation happen on the JavaScript side.

There are two modules. `BeaconBluetooth` is the radio and everything that touches it.
`BeaconExport` (M9) writes a document to a private directory and presents the platform share
sheet; it is separate because neither of those is a Bluetooth operation, and folding them in
would make the BLE module's surface and its error union mean two things (ADR 0010). Both are
generated from the specs in `apps/mobile/src/native/specs`.

## Spec: BeaconBluetooth

`apps/mobile/src/native/specs/NativeBeaconBluetooth.ts`

```ts
export interface Spec extends TurboModule {
  getBluetoothState(): Promise<string>;
  getPermissionState(): Promise<string>;
  requestPermission(): Promise<string>;
  startScan(serviceUuids: string[], allowDuplicates: boolean): Promise<void>;
  stopScan(): Promise<void>;
  connect(deviceId: string): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  readRssi(deviceId: string): Promise<number>;
  discoverServices(deviceId: string): Promise<GattServicePayload[]>;
  readCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<number[]>;
  writeCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    bytes: number[],
    withResponse: boolean,
  ): Promise<void>;
  setNotify(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    enabled: boolean,
  ): Promise<void>;
  readonly onBluetoothStateChanged: CodegenTypes.EventEmitter<{ state: string }>;
  readonly onDeviceDiscovered: CodegenTypes.EventEmitter<DeviceDiscoveredEvent>; // BleDevice shape
  readonly onConnectionStateChanged: CodegenTypes.EventEmitter<{
    deviceId: string;
    state: string;
  }>;
  readonly onCharacteristicValueChanged: CodegenTypes.EventEmitter<{
    deviceId: string;
    serviceUuid: string;
    characteristicUuid: string;
    bytes: number[];
    timestamp: string; // ISO-8601, taken natively at receipt
  }>;
  readonly onBleError: CodegenTypes.EventEmitter<{
    deviceId?: string;
    error: BleErrorPayload;
  }>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('BeaconBluetooth');
```

Codegen configuration lives in `apps/mobile/package.json` (`codegenConfig`), and one
configuration covers both specs: `jsSrcsDir` is the whole `src/native/specs` directory.
`ios.modulesProvider` maps each module name to its Objective-C++ class
(`BeaconBluetooth` → `BeaconBluetoothModule`, `BeaconExport` → `BeaconExportModule`), so
neither needs `RCT_EXPORT_MODULE`; on Android each is registered by hand in
`MainApplication.kt` (`BeaconBluetoothPackage()`, `BeaconExportPackage()`), because they live
in the app rather than in a library and autolinking does not see them.

Generated artifacts (never committed):

- iOS: `ios/build/generated/ios/ReactCodegen/BeaconBluetoothSpec/BeaconBluetoothSpec.h` defines
  `NativeBeaconBluetoothSpec` (protocol), `NativeBeaconBluetoothSpecBase` (event emitter base
  class) and `NativeBeaconBluetoothSpecJSI`. Every spec in `jsSrcsDir` lands in that one
  umbrella header, named after `codegenConfig.name`, so `NativeBeaconExportSpec` is declared
  there too and `BeaconExportModule.h` imports the Bluetooth-named header despite having
  nothing to do with Bluetooth.
- Android: `com.beacon.bluetooth.spec.NativeBeaconBluetoothSpec` and
  `com.beacon.bluetooth.spec.NativeBeaconExportSpec` (abstract classes with one `Promise`
  method per spec method and one `emitOn…(ReadableMap)` per emitter). The package comes from
  `codegenConfig.android.javaPackageName`, which the Gradle plugin honors, and is shared by
  both specs for the same reason.

Scalar parameters are chosen over object parameters (`startScan(serviceUuids, allowDuplicates)`
rather than `startScan(options)`) because arrays and primitives map to plain `NSArray`/`BOOL` and
`ReadableArray`/`Boolean`, whereas object parameters generate C++ struct wrappers on iOS. The same rule gives
`writeCharacteristic` five scalar arguments rather than the `WriteCharacteristicRequest` object
the contract uses; the wrapper flattens the request and maps `mode` onto the `withResponse`
boolean.

### Characteristic values (M5)

`readCharacteristic(deviceId, serviceUuid, characteristicUuid)` resolves with the value as
unsigned bytes. `writeCharacteristic(deviceId, serviceUuid, characteristicUuid, bytes,
withResponse)` writes them; with `withResponse` the promise waits for the peripheral's
acknowledgement, without it the promise resolves once the platform stack has accepted the
write, which says nothing about whether the peripheral received it. Both are queued behind any
other GATT operation on the same peripheral (ADR 0006) and reject with:

| Code                       | When                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `disconnected`             | No `ready` link to the device, or the link ended while the operation was queued or in flight                                                  |
| `service_not_found`        | The discovered table has no such service                                                                                                      |
| `characteristic_not_found` | The service has no such characteristic                                                                                                        |
| `read_failed`              | The platform reported an error (status kept in `nativeCode`), or the characteristic lacks the `read` property ("Read not permitted")          |
| `write_failed`             | The platform reported an error, or the characteristic lacks `write` / `write_without_response` for the requested mode ("Write not permitted") |
| `invalid_payload`          | A write byte outside `0..255` (rejected natively), or a read result outside it (rejected by the wrapper)                                      |

Byte arrays: values cross the bridge as `number[]` of integers in `0..255`, in both directions.
`Uint8Array` is not a codegen type and Hermes has no `TextDecoder`, so the application layer
works on plain arrays throughout (`@beacon/ble-contracts` `bytes.ts`). A pure `ByteArrayMapper`
on each platform does the conversion and the range check: iOS between `[NSNumber]` and `Data`,
Android between the doubles React Native delivers and the JVM's signed `ByteArray`, unpacking
reads as unsigned integers so `0xFF` arrives as `255` on both. A fractional, negative,
oversized or non-finite value in a write is rejected with `invalid_payload` before the stack
sees it. The protocol parsers (M7) take the same `number[]` and convert to `Uint8Array`
inside the registry, so nothing about the bridge changed for them (ADR 0008).

### Notifications and indications (M6)

`setNotify(deviceId, serviceUuid, characteristicUuid, enabled)` subscribes to, or unsubscribes
from, a characteristic and resolves once the peripheral has acknowledged the change, not when
the request was handed to the stack: on iOS when `didUpdateNotificationStateFor` reports the
new state, on Android when `onDescriptorWrite` confirms the Client Characteristic
Configuration descriptor write. Native picks a notification when the characteristic offers
`notify` and an indication only when it offers `indicate` alone; the caller does not choose.
The call is queued behind any other GATT operation on the same peripheral (ADR 0006) and
rejects with:

| Code                       | When                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `disconnected`             | No `ready` link to the device, or the link ended while the change was queued or in flight                                                                                      |
| `service_not_found`        | The discovered table has no such service                                                                                                                                       |
| `characteristic_not_found` | The service has no such characteristic                                                                                                                                         |
| `subscription_failed`      | The platform reported an error or refused the request (status kept in `nativeCode`), or the characteristic has neither `notify` nor `indicate` ("Notifications not supported") |

Values then arrive on `onCharacteristicValueChanged` as `{ deviceId, serviceUuid,
characteristicUuid, bytes, timestamp }`: `bytes` are unsigned `0..255` like a read result and
`timestamp` is the ISO-8601 instant native received the value, taken on the CoreBluetooth
queue or the binder thread before the bridge hop so a burst keeps its order and spacing (ADR
0007). The wrapper validates every event (`characteristicValueChangedEventSchema`: UUIDs
normalized to canonical form, byte range, ISO timestamp) into `characteristic.value_changed`;
a malformed one becomes a `ble.error` with `invalid_payload`. One event per value crosses the
bridge; batching happens in the application layer, not here.

Every subscription ends with the link. Neither platform reports that per characteristic, so
there is no "unsubscribed" event: JavaScript drops its subscription state when the connection
leaves `ready`, and a `setNotify` still waiting is rejected with `disconnected` like any other
queued operation.

CCCD: Android's `setCharacteristicNotification` only routes `onCharacteristicChanged` to the
app; the peripheral starts pushing values only after the client writes the Client
Characteristic Configuration descriptor (`0x2902`) with `ENABLE_NOTIFICATION_VALUE`,
`ENABLE_INDICATION_VALUE` or `DISABLE_NOTIFICATION_VALUE`, which `DeviceConnection` does
inside the queued operation. A characteristic that advertises `notify` or `indicate` without
that descriptor cannot be configured remotely; the request is refused with `subscription_failed`
("The characteristic has no client characteristic configuration descriptor") and the local
switch is flipped back, as CoreBluetooth refuses it on iOS.
CoreBluetooth performs the descriptor write itself inside `setNotifyValue(_:for:)`, which is
why the iOS side has no descriptor code.

The iOS and Android builds run codegen automatically. The standalone
`react-native codegen` command also works for inspection, but note that it ignores
`javaPackageName` for app projects and emits the Android spec under `com.facebook.fbreact.specs`;
the Gradle build is the source of truth.

## iOS (BeaconBluetooth)

```text
BeaconBluetoothModule.mm  (Objective-C++)  — conforms to the generated spec, forwards to Swift
BluetoothManager.swift                     — owns CBCentralManager; adapter state, permission, scanning, connections
PeripheralSession.swift                    — one CBPeripheral + private CBPeripheralDelegate proxy, pending completions, GATT queue, subscribed set
GattOperationQueue.swift                   — pure per-peripheral serialization of GATT operations (ADR 0006)
Mapping/BluetoothStateMapper.swift         — CBManagerState → wire value
Mapping/ConnectionStateMapper.swift        — BleConnectionState wire vocabulary, CBPeripheralState mapping
Mapping/GattMapper.swift                   — CBService/CBCharacteristic → GattService payloads, property option set → wire values, canonical UUID for lookups
Mapping/ByteArrayMapper.swift              — [NSNumber] ⇄ Data with 0...255 range validation
Mapping/CharacteristicValueMapper.swift    — pushed value → CharacteristicValueChangedEvent payload (canonical UUIDs, ISO timestamp), subscription keys
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

Reads and writes: `PeripheralSession` owns a `GattOperationQueue` and the in-flight read and
write completions. `readCharacteristic` looks the characteristic up in the cached table
(comparing `GattMapper.canonicalUuid` on both sides, because CoreBluetooth abbreviates
SIG-assigned UUIDs while JavaScript sends the 128-bit form), checks the `read` property, and
enqueues `peripheral.readValue(for:)`; `didUpdateValueFor` settles the completion with the
bytes (or the error) and calls `finish()`. `writeCharacteristic` validates the bytes with
`ByteArrayMapper`, checks the property for the requested mode and enqueues
`writeValue(_:for:type:)`: `.withResponse` is answered by `didWriteValueFor`;
`.withoutResponse` completes as soon as CoreBluetooth accepted the data because no callback
follows, and its `start` returns `false` so the queue moves on at once.
`canSendWriteWithoutResponse` back-pressure is not observed yet, so a burst that overruns the
stack's buffer is dropped by CoreBluetooth rather than reported. A link that ends for any
reason cancels the queue and rejects every waiting completion with `disconnected` before the
transition is emitted.

Notifications: `setNotify` resolves the characteristic the same way, checks `.notify` /
`.indicate` (neither rejects with `subscription_failed`, "Notifications not supported"), and
enqueues `setNotifyValue(_:for:)` with the completion kept in `pendingNotify`; the request is
forwarded even when `isNotifying` already matches, so the completion reports the peripheral's
answer rather than cached state. `didUpdateNotificationStateFor` records the peripheral's
`isNotifying` in the session's `subscribedCharacteristics` (keyed by canonical UUIDs through
`CharacteristicValueMapper.subscriptionKey`) on every successful callback, settles the pending
completion (a CoreBluetooth error maps to `subscription_failed`) and calls `finish()`. A
`didUpdateValueFor` with no read pending for that characteristic is a notification or
indication: `CharacteristicValueMapper.map` builds the event with canonical UUIDs, the bytes
via `ByteArrayMapper` (a nil value becomes an empty packet) and the receipt time stamped on
the manager's queue in ISO-8601 (`AdvertisementMapper.isoTimestamp`), and it is emitted on
`onCharacteristicValueChanged`. The subscribed set is bookkeeping only and is not consulted
before emitting, so a value that lands before the acknowledgement is not dropped; an error
in such an update is emitted as a device-scoped `ble.error` with `subscription_failed`, which
the connection coordinator ignores because operation-level codes never mean the link is gone. A
link that ends clears the subscribed set, because CoreBluetooth drops subscriptions with the
connection, and the queue cancellation rejects a pending `setNotify` with `disconnected`.

## Android (BeaconBluetooth)

```text
BeaconBluetoothModule.kt   — extends generated NativeBeaconBluetoothSpec, module lifecycle
BeaconBluetoothPackage.kt  — BaseReactPackage registration (isTurboModule = true)
BluetoothController.kt     — BluetoothManager/BluetoothAdapter, ACTION_STATE_CHANGED receiver
scanning/BleScanner.kt     — BluetoothLeScanner, pre-flight checks, throttling, onScanFailed
connection/ConnectionRegistry.kt — one DeviceConnection per address, shared pre-flight checks
connection/DeviceConnection.kt   — BluetoothGatt + BluetoothGattCallback, state machine, pending promises, GATT queue, descriptor writes
connection/GattOperationQueue.kt — pure per-connection serialization of GATT operations (ADR 0006)
permissions/*              — runtime permission flow (see PERMISSIONS.md)
mapping/BluetoothStateMapper.kt, ConnectionStateMapper.kt, GattStatusMapper.kt, GattTreeMapper.kt, ByteArrayMapper.kt, NotificationDescriptorMapper.kt, ScanResultMapper.kt, BleUuid.kt, ScanFailureMapper.kt, IsoTimestamp.kt
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

Reads and writes: `DeviceConnection` owns a `GattOperationQueue` under the same instance lock
as the state machine. `readCharacteristic` finds the characteristic in the discovered tree,
checks `PROPERTY_READ`, and enqueues `BluetoothGatt.readCharacteristic`; the result arrives in
`onCharacteristicRead`, on API 33+ through the overload that carries the value and on older
devices through the legacy one that reads `characteristic.value`. `writeCharacteristic` checks
the property for the requested mode and enqueues a write with `WRITE_TYPE_DEFAULT` or
`WRITE_TYPE_NO_RESPONSE`: on API 33+ through `writeCharacteristic(characteristic, value,
writeType)`, on older devices by setting the characteristic's value and write type first
(the deprecated path). Both are answered by `onCharacteristicWrite`, which for a write without
response confirms only that the local stack sent it. A `false` or non-success return from the
platform call settles the promise with `write_failed` / `read_failed` and lets the queue move
on; closing the client cancels the queue and rejects every waiting promise with `disconnected`.

Notifications: `setNotify` finds the characteristic in the discovered tree and asks
`NotificationDescriptorMapper.cccdValue` for the descriptor value its property bits call for:
`ENABLE_NOTIFICATION_VALUE`, `ENABLE_INDICATION_VALUE` only when the characteristic lacks
`notify`, `DISABLE_NOTIFICATION_VALUE` when disabling, and none for a characteristic with
neither property, which rejects with `subscription_failed` ("Notifications not supported")
without entering the queue. The queued operation calls
`setCharacteristicNotification(characteristic, enabled)`, the stack's local delivery switch,
and then writes the Client Characteristic Configuration descriptor
(`NotificationDescriptorMapper.CCCD_UUID`, `0x2902`): on API 33+ through
`writeDescriptor(descriptor, value)`, whose status `GattStatusMapper.requestRejection`
interprets, on older devices through the deprecated path that sets `descriptor.value` first.
`onDescriptorWrite` settles the pending change (`pendingNotify`), records it in the
connection's `subscribed` set on success or, on a non-success status, flips the local switch
back and rejects with `subscription_failed` and the status in `nativeCode`, and lets the queue
move on. A characteristic without the descriptor is refused up front with `subscription_failed`
and the local switch flipped back, so the app never shows a subscription that cannot deliver.
`onCharacteristicChanged` (the
API 33 overload that carries the value and the legacy one that reads `characteristic.value`)
stamps the value with `IsoTimestamp` on the binder thread before taking the lock, formats
both UUIDs with `BleUuid.format` so they match the discovered table, and hands it to the
module, which emits the event with the bytes unpacked as unsigned integers. Closing the
client ends every subscription (the `subscribed` set is cleared with the link); the queue
cancellation rejects a pending `setNotify` with `disconnected`.

## The export module (M9)

`apps/mobile/src/native/specs/NativeBeaconExport.ts`

```ts
export interface Spec extends TurboModule {
  writeTemporaryFile(fileName: string, contents: string): Promise<string>;
  shareFile(path: string, mimeType: string): Promise<boolean>;
  clearTemporaryFiles(): Promise<number>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('BeaconExport');
```

Three calls, no events, and nothing but strings, a boolean and a number across the boundary.

`writeTemporaryFile(fileName, contents)` writes `contents` as UTF-8 into a private directory
the module owns and resolves with the absolute path, replacing any file already there under
the same name. `fileName` is a name, not a location: native reduces it to its last path
component, so a caller cannot choose where in the container the file lands, and a name that
reduces to nothing usable (empty, `.`, `..`) is refused.

`shareFile(path, mimeType)` presents the platform share sheet for a file this module wrote.
The path is checked for containment first — a path the module did not write never reaches a
sheet — and `mimeType` tells Android what the file is (iOS works it out from the extension and
ignores the argument, because telling the sheet something the extension contradicts would only
confuse the activities it offers).

`clearTemporaryFiles()` empties that directory and resolves with how many files went. It never
rejects: a directory that is already empty, or was never created, is the state the caller
asked for.

The boolean `shareFile` resolves with means "did the person complete a share", and the two
platforms can answer it to different depths. iOS answers accurately:
`UIActivityViewController`'s completion handler distinguishes a completed activity from a
dismissal, so `false` means the sheet was closed without sharing. Android always resolves
`true` once the chooser has been started, because `Intent.createChooser` finishes as soon as a
target is picked, the target then runs in its own task, and almost none of them report a
result — a completion signal there would say "cancelled" for most successful shares, and
answering wrongly is worse than not answering. Callers therefore read `false` as "definitely
dismissed" and `true` as "not known to be dismissed", never as proof the document went
anywhere, which is why the UI says a file "was handed to the share sheet" (ADR 0010).

Rejections carry an `ExportErrorCode` (`@beacon/session-export`), deliberately not a
`BleErrorCode`:

| Code                   | When                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `export_write_failed`  | The document could not be written: an unusable file name, or the file system refused (the system's description is kept) |
| `export_share_failed`  | No sheet could be presented: no view controller on iOS, no foreground Activity on Android, or the chooser threw         |
| `export_file_missing`  | The path is not one this module wrote, or the file is no longer there                                                   |
| `export_source_failed` | The session or its events could not be read back from the store (raised in JavaScript, never natively)                  |
| `export_unknown`       | The fallback for anything else (raised in JavaScript)                                                                   |

Only the first three can come from native, so the Swift `ExportErrorCode` enum and the Kotlin
constants list those three rather than carrying cases they can never produce. The wire values
are the strings above on every platform.

iOS (`apps/mobile/ios/BeaconExport`):

```text
BeaconExportModule.h/.mm  (Objective-C++) — conforms to the generated spec, forwards to Swift
ExportManager.swift                       — @objc composition root; ExportErrorCode / ExportError with its payload dictionary; file work on a private queue
ExportFileStore.swift                     — owns <tmp>/beacon-exports: write, containment, existence, clear (no UIKit, unit tested)
ShareSheetPresenter.swift                 — UIActivityViewController from the top view controller of the foreground scene, iPad popover anchoring
```

The shim is as thin as `BeaconBluetoothModule.mm`: it forwards each call and turns an
`ExportError.payload` dictionary into `reject(code, message, NSError)` so JavaScript's
`toExportError` reads the contract code off the rejection, the same convention the BLE module
uses. `shareFile` resolves `@YES`/`@NO` rather than `@(shared)`, because the bridge only turns
a boolean `NSNumber` into a JavaScript boolean and whether `@()` produces one depends on how
`BOOL` is defined for the architecture. File work runs on a private `userInitiated` queue and
hops to the main thread to present, which is the only thread that can. `ExportFileStore`
standardises and symlink-resolves both paths and compares path components, so a `..` in the
middle cannot walk out of the directory and back in, and a sibling directory whose name merely
starts with ours does not pass.

Android (`apps/mobile/android/app/src/main/java/com/beacon/export`):

```text
BeaconExportModule.kt   — extends the generated NativeBeaconExportSpec; FileProvider URI, ACTION_SEND, chooser
BeaconExportPackage.kt  — BaseReactPackage registration (isTurboModule = true), added in MainApplication
ExportFileStore.kt      — owns <cacheDir>/beacon-exports: write, containment by canonical path, clear (no framework types, unit tested)
```

The file leaves the app as a `content://` URI from a `FileProvider` declared in the manifest
with authority `${applicationId}.exports`, `android:exported="false"` and
`android:grantUriPermissions="true"`, scoped by `res/xml/export_paths.xml` to the one
`beacon-exports` cache subdirectory — the rest of the cache holds the JavaScript bundle,
images and the database's working files, and none of that should be reachable through a share.
`FLAG_GRANT_READ_URI_PERMISSION` is set on both the `ACTION_SEND` intent and the chooser,
because the grant travels with the intent that is actually started. The chooser is started
from `currentActivity`; without one the call rejects with `export_share_failed` rather than
starting it from the application context, which would put the sheet in its own task behind the
app. `clearTemporaryFiles` resolves a `Double` because the spec's return type is a JavaScript
`number`, which has no integers.

## JavaScript wrapper

`apps/mobile/src/native/createNativeBleClient.ts` implements `BleClient`, which since M6 is
the whole `NativeBleClient` contract (`BluetoothAdapterApi & PermissionApi & ScanApi &
ConnectionApi & GattDiscoveryApi & GattValueApi & GattNotifyApi`):

- Value-returning calls validate the result (`parseBluetoothState`, `parseBlePermissionState`);
  invalid values reject with `BleError("invalid_payload")`; native rejections are mapped with
  `toBleError` and default to `native_failure`.
- `startScan(options)` fills explicit defaults (`[]`, `false`) before crossing the bridge;
  `stopScan()` never throws for "not scanning".
- `connect` rejections default to `connection_failed`; `readRssi` results are range-checked
  (`parseRssi`), so a bogus 127 from a platform becomes `invalid_payload`.
- `discoverServices` results are validated with `parseGattServices`: every UUID is normalized
  to canonical form and every property must be a `CharacteristicProperty`.
- `readCharacteristic` results are validated with `parseByteArray` (every element an integer in
  `0..255`); rejections default to `read_failed`. `writeCharacteristic(request)` flattens the
  request onto the five scalar spec arguments, mapping `mode: 'with_response'` onto
  `withResponse: true`; rejections default to `write_failed`.
- `setNotify(request)` flattens the `NotificationRequest` onto the four scalar spec arguments;
  rejections default to `subscription_failed`.
- `subscribe()` folds the five typed emitters into the `NativeBleEvent` union, validates each
  payload (`scan.device_discovered` and `characteristic.value_changed` also normalize UUIDs;
  the latter checks the byte range and the native timestamp too), and returns one unsubscribe
  function that removes every native subscription.

`apps/mobile/src/native/createNativeExportClient.ts` does the same job for `ExportClient`. The
export module returns primitives, so what it does is a type check rather than a schema parse:
a `writeTemporaryFile` that resolves without a path, or a `shareFile` that resolves with
something other than a boolean, means native and the spec disagree, which is raised loudly
rather than coerced. Rejections go through `toExportError` with a per-call default
(`export_write_failed`, `export_share_failed`, and `export_unknown` for a clear).
`clearTemporaryFiles` is the one call that forgives a nonsensical answer, resolving 0, because
the count is advisory and nothing branches on it. `ExportClientProvider` /
`useExportClient` inject the client the way `BleClientProvider` does, and
`tests/fakes/FakeExportClient.ts` implements the same contract so the App tests drive an
export without mocking the module.

## Error convention

Native rejects promises with `code` set to a `BleErrorCode` wire value and the message as a
human readable string. Android additionally passes `nativeCode`/`nativeDomain` through the
rejection `userInfo`. JavaScript reads `code` in `toBleError`.

`BeaconExport` follows the same convention with its own union: the `code` is an
`ExportErrorCode` and `createNativeExportClient` reads it with `toExportError`. It carries no
platform diagnostics, because none of its failures come from a framework with a code worth
showing and the system's own description already says what went wrong when a write fails. The
two unions are kept apart on purpose (ADR 0010), so an exhaustive switch over `BleErrorCode`
never has to answer for a full disk.

## Extending the bridge

1. Add the method or emitter to the spec using codegen-compatible types. A capability that is
   not about the radio gets its own module and its own error union rather than a method on
   `BeaconBluetooth`; `BeaconExport` is the worked example.
2. Add the matching segment implementation to the contract wrapper and validate its payloads.
3. Implement in Swift (`BluetoothManager` or a new `PeripheralSession`) and expose through the
   `.mm` shim. A GATT operation goes through the session's `GattOperationQueue` and calls
   `finish()` from its delegate callback.
4. Implement in Kotlin (`BluetoothController` / `DeviceConnection`) and override in the module.
   A GATT operation goes through the connection's `GattOperationQueue` under the instance lock.
5. Add JS tests with a fake spec, plus XCTest and JUnit tests for pure mapping logic.
