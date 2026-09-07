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
sees it.

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

## iOS

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

## Android

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

## Error convention

Native rejects promises with `code` set to a `BleErrorCode` wire value and the message as a
human readable string. Android additionally passes `nativeCode`/`nativeDomain` through the
rejection `userInfo`. JavaScript reads `code` in `toBleError`.

## Extending the bridge

1. Add the method or emitter to the spec using codegen-compatible types.
2. Add the matching segment implementation to the contract wrapper and validate its payloads.
3. Implement in Swift (`BluetoothManager` or a new `PeripheralSession`) and expose through the
   `.mm` shim. A GATT operation goes through the session's `GattOperationQueue` and calls
   `finish()` from its delegate callback.
4. Implement in Kotlin (`BluetoothController` / `DeviceConnection`) and override in the module.
   A GATT operation goes through the connection's `GattOperationQueue` under the instance lock.
5. Add JS tests with a fake spec, plus XCTest and JUnit tests for pure mapping logic.
