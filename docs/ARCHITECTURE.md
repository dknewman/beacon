# Architecture

Beacon is a monorepo with one React Native application and shared TypeScript packages. The
guiding constraint is PROJECT.md section 3: Bluetooth logic lives in native platform code; React
Native consumes a narrow typed bridge; state is explicit.

## Layers

| Layer          | Location                                                                          | Owns                                                                                   | Must not                                 |
| -------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| UI             | `apps/mobile/src/features/**/*Screen.tsx`, `src/components`, `src/app/navigation` | Rendering, accessibility, user intent, routes by id                                    | Call the bridge directly, hold BLE state |
| Application    | `apps/mobile/src/features/**` (reducers, hooks, coordinators, providers)          | Explicit state machines, orchestration, buffering                                      | Import platform APIs                     |
| Contracts      | `packages/ble-contracts`                                                          | Domain models, state unions, error codes, `NativeBleClient` segments, `NativeBleEvent` | Depend on React Native                   |
| Validation     | `packages/validation`                                                             | zod schemas for every boundary payload and for parser output, `ValidationResult`       | Know about UI                            |
| Parsers        | `packages/protocol-parsers`                                                       | `ByteReader`, the SIG and text parsers, the registry, `ParseOutcome`                   | Import UI or application code            |
| Bridge wrapper | `apps/mobile/src/native`                                                          | Codegen spec, `createNativeBleClient`, dependency injection context, mock client       | Contain BLE policy                       |
| Native         | `apps/mobile/ios/BeaconBluetooth`, `apps/mobile/android/.../bluetooth`            | CoreBluetooth / BluetoothGatt, GATT queue, event emission, error mapping               | Trust JS for connection state            |

Dependency direction is strictly downward in the table. `packages/*` never import from
`apps/mobile`. Among the packages the direction is `ble-contracts` ← `validation` ←
`protocol-parsers` ← `apps/mobile`: the contracts know nothing of validation, validation
knows nothing of the parsers, and the parsers know nothing of the app.

## Data flow (M0–M7)

```text
NavigationContainer ─ DeviceListScreen ──► DeviceDetailScreen ──► GattInspectorScreen ──► CharacteristicDetailScreen
   ▲ reads                                 ▲ reads by id, polls RSSI      ▲ reads the cached table by id   ▲ reads, writes, subscribes, lists packets
   │                                                                                                        │ parsePacket / packetSummary (@beacon/protocol-parsers) over the packet log, at render time
ScanProvider: readiness + scan + device cache   ConnectionProvider: per-device machine   GattProvider: per-device table   PacketLogProvider: per-device ring buffer   SubscriptionProvider: per-characteristic subscription, 100 ms flush
   ▲                                              ▲                    ▲                     ▲                    ▲ useCharacteristicOperations        ▲ recordMany (batched) ─────────┘
   │ BluetoothAdapterApi / PermissionApi          │ ScanApi            │ ConnectionApi       │ GattDiscoveryApi   │ GattValueApi (read / write)         │ GattNotifyApi (setNotify)
   │                                              │ scan.device_discovered / ble.error (no deviceId)
   │                                              │                    │ connection.state_changed / ble.error (deviceId)
   │                                                                                                                                                    │ characteristic.value_changed (native timestamp)
createNativeBleClient
   │ parseBluetoothState / parseBlePermissionState / parseNativeBleEvent (zod)
   │        ← invalid → BleError("invalid_payload") / ble.error event
   ▼
NativeBeaconBluetooth (Turbo Module spec, codegen)
   │
   ├─ iOS: BeaconBluetoothModule.mm → BluetoothManager.swift (+ PeripheralSession, GattOperationQueue) → CBCentralManager / CBPeripheral
   └─ Android: BeaconBluetoothModule.kt → BluetoothController / BleScanner / ConnectionRegistry (+ DeviceConnection, GattOperationQueue) → BluetoothAdapter / BluetoothLeScanner / BluetoothGatt
```

Ordering rule: subscribe to events before the initial read so a transition during the read is
not lost. Late results after unmount are ignored by an `active` flag in the effect. The scan
coordinator is the only caller of `ScanApi`, the connection coordinator the only caller of
`ConnectionApi`, `useCharacteristicOperations` the only caller of `GattValueApi`, and the
subscription provider the only caller of `GattNotifyApi`; screens express intent (`start`,
`stop`, `connect`, `disconnect`, `read`, `write`, `subscribe`, `unsubscribe`) and read derived
state. The coordinators live above the navigator (ADR 0005), so scanning, links, subscriptions
and the packet history survive screen changes.

Provider order in `App.tsx`, outermost first: `BleClientProvider` → `ScanProvider` →
`ConnectionProvider` → `GattProvider` → `PacketLogProvider` → `SubscriptionProvider` →
navigation. Each provider may read the ones above it (the GATT provider watches the connection
machine to drop a table with its link; the packet log is written by the characteristic
operations hook underneath it and by the subscription provider's flush; the subscription
provider watches the connection machine to drop subscriptions with their link) and never the
ones below.

## GATT operations and the packet log (M5)

`features/gatt/characteristicOperations.ts` is the per-characteristic operation reducer
(`busy: idle | reading | writing`, `lastOutcome`) and its status text;
`useCharacteristicOperations.ts` drives one read or write at a time through `GattValueApi`,
records a successful read as an `incoming` packet and a successful write as an `outgoing` one,
and keeps failures in the outcome. `CharacteristicDetailScreen.tsx` composes them with
`WriteForm.tsx` (HEX / Decimal / UTF-8 input, parsed on every keystroke with the validation
message or byte preview, write buttons per property) and `ValueColumns.tsx` (HEX, DECIMAL,
BINARY, ASCII, UTF-8 for the latest packet).

`features/packets/` is the shared history: `packetLogReducer.ts` (per-device ring buffer of
`BlePacket`, newest first, capacity 500, `createPacket` ids), `PacketLogProvider.tsx` (above
navigation; `record`, `clear`, `packetsOf`, `packetsForCharacteristic`) and
`packetPresentation.ts` (row labels with millisecond times). Byte encoding and the write-form
parsers live in `@beacon/ble-contracts` (`bytes.ts`) so the protocol parsers (M7) and the M8
recorder work on the same `number[]` representation that crosses the bridge (ADR 0006).

## Subscriptions and the buffered value pipeline (M6)

`features/subscriptions/subscriptionReducer.ts` is the per-characteristic subscription
reducer (`subscriptionsReducer` over `SubscriptionsState`, one `CharacteristicSubscription`
per `deviceId/serviceUuid/characteristicUuid` key: `phase: off | subscribing | on |
unsubscribing`, `notificationCount`, `lastValueAt`, `lastError`) and the status row text
(`describeSubscription`). `SubscriptionProvider.tsx` sits above navigation and is the only
caller of `GattNotifyApi` (`useSubscriptions()`: `subscriptionOf`, `subscribe`,
`unsubscribe`): it moves an entry to `subscribing` / `unsubscribing` while `setNotify` is in
flight, to `on` / `off` when the peripheral's acknowledgement resolves the promise, keeps a
rejection in `lastError`, and drops every entry of a device (`link_ended`) when the connection
coordinator reports the device is no longer `ready`, because native drops the subscriptions
with the link (ADR 0007).

Incoming `characteristic.value_changed` events never touch React state one by one
(PROJECT.md 17, 37). The provider turns each into an `incoming` packet with the native
timestamp, appends it to a ref buffer and arms one timer (`flushIntervalMs`, default 100);
when it fires, the buffer is flushed with one `packets_recorded` batch into the packet log
(`PacketLogProvider.recordMany`) and one `values_received` action carrying a count and the
newest timestamp per characteristic, so a 100 Hz stream causes at most ten renders per second
and the log stays bounded at 500 packets per device. Timestamps are taken natively at receipt,
so buffering changes when a value is shown, never when it is recorded as having arrived.
`CharacteristicDetailScreen.tsx` reads the entry for its Subscribe / Unsubscribe button (shown
for `notify` or `indicate`, enabled only with a `ready` link, labelled "Subscribing…" /
"Unsubscribing…" while busy) and its "Notifications" row (phase and count, with the failure
reason and code when a change was refused); the value card says when the latest value was
received, and the value columns and the packet list update from the same batched log as reads
and writes. Failures are reported in the row, not logged as packets.

## Protocol parsers (M7)

`packages/protocol-parsers` (`@beacon/protocol-parsers`) turns characteristic bytes into a
`ParsedValue` (`@beacon/ble-contracts` `parsed-value.ts`: `parserId`, `label`, one-line
`summary`, `fields` of `{ name, value, unit? }`). `reader.ts` is a bounds-checked
little-endian `ByteReader` (`uint8`, `uint16`, IEEE 11073 SFLOAT with its special values, the
seven-byte Date Time, `expectEnd`) whose every failure is a `ParseError` naming the field.
`parsers/` holds one `BleParser` per characteristic, matched on the canonical characteristic
UUID in the `ParserContext`: `batteryLevel` (`2A19`), `heartRateMeasurement` (`2A37`),
`weightMeasurement` (`2A9D`), `bloodPressureMeasurement` (`2A35`), `utf8Text` (the SIG string
characteristics and the Nordic UART lines) and `rawBytes`, which matches everything and never
fails. `registry.ts` is `createParserRegistry(parsers)`: first match in registration order,
the raw fallback appended when missing, `parse(bytes, context)` accepting the bridge's
`number[]` or a `Uint8Array` and returning a `ParseOutcome`, `{ ok: true, value }` or
`{ ok: false, parserId, reason, fallback }`; a thrown `ParseError` and a result
`parsedValueSchema` rejects both become the failed outcome carrying the raw fallback.
`standardParsers` and `defaultParserRegistry` are the PROJECT.md 19 set, most specific first
(ADR 0008). The package imports nothing from the app or from React.

`apps/mobile/src/features/parsers/` is the glue: `parsePacket(packet, registry)` builds the
context from the packet's UUIDs, `presentableValue` hides a plain raw reading (the HEX column
already shows it) but keeps a failed parse with its reason, `packetSummary` gives a row its
one line, `formatField` renders a field with its unit; `ParsedValueView.tsx` shows the
label, the summary, an error line naming the parser and reason when parsing failed, then the
fields. `CharacteristicDetailScreen.tsx` renders it above the value columns for the latest
packet and a summary on each packet row (also in the row's accessibility label). Parsing is
stateless and happens at render time over the packet log: no parsed-value state, no
reducer, nothing to keep in sync with the 100 ms flush; the screen lists at most 20 packets,
so the cost is bounded and small next to the five encodings the value columns compute.

## Composition root

`apps/mobile/src/app/bootstrap.tsx` is the only file that references the real Turbo Module. It
creates the validated client and injects it through `BleClientProvider`, or, when
`USE_MOCK_BLE_CLIENT` is set in `runtimeOptions.ts`, the scripted mock client from `src/mock`.
Tests render `App` with `FakeBleClient`, which keeps every native call pending until the test
settles it.

## Contract segmentation

`NativeBleClient` is composed from `BluetoothAdapterApi`, `PermissionApi`, `ScanApi`,
`ConnectionApi` and `GattApi`. Each milestone ships a complete implementation of one segment in
TypeScript, Swift and Kotlin, rather than stubbing unimplemented methods with fake successes.
`GattApi` is itself split: `GattDiscoveryApi` (M4), `GattValueApi` (M5: `readCharacteristic`,
`writeCharacteristic`) and `GattNotifyApi` (M6: `setNotify`). `BleClient` (the app's type) was
the intersection of the segments implemented so far; since M6 every segment has a native
implementation, so `BleClient` equals `NativeBleClient` and stays as the one name screens and
tests depend on.

## State management

State is separated by responsibility (PROJECT.md 5). M0 introduced the adapter reducer, M1 the
permission reducer and readiness projection, M2 the scan reducer, device cache and in-memory
filters, M3 the per-device connection reducer, M4 the per-device GATT table tied to the link,
M5 the per-characteristic operation reducer and the per-device packet log, M6 the
per-characteristic subscription reducer with its value buffer; M7 adds no state, because
parsed values are derived from the packet log at render time; sessions, UI state and
persisted preferences each get their own module as their milestones land. There is no
global store: each concern is a reducer behind a provider or hook, and screens compose them.

## Platform differences

Handled explicitly in native code and documented at the contract:

- `BluetoothState.unauthorized` is a native adapter state on iOS only; Android expresses it as a
  permission result.
- `BluetoothState.resetting` is iOS only; Android's transitional turning on/off states are
  reported as `powered_off`.
- Device identifiers are `CBPeripheral.identifier` UUIDs on iOS and MAC addresses on Android and
  are not portable across devices.
- UUID formatting differs; `normalizeUuid` produces one canonical form at the boundary.
- Scan callbacks differ (iOS reports once per peripheral unless duplicates are requested; Android
  reports every advertisement and rate-limits scan starts). ADR 0004 records how M2 handles both.
- Manufacturer data: iOS hands over the raw bytes, Android splits them by company id;
  `ScanResultMapper` re-serializes the Android form with the little-endian company id so both
  platforms produce the same hex string.
- Service discovery: Android hands over the complete tree in one callback; CoreBluetooth needs
  one `discoverCharacteristics` round trip per service. Both platforms finish the whole tree
  before reporting `ready`, so `discoverServices` is a cached read on either.
- Connection timeouts: CoreBluetooth never times out, Android does after ~30 s with status 133.
  JavaScript owns one 15 s timeout for both (ADR 0005). Cancelling a pending attempt has no
  guaranteed callback on either platform, so native settles cancellations itself.
- GATT operations: neither stack accepts a second read or write before the first is answered
  (CoreBluetooth misorders the callbacks, `BluetoothGatt` returns `false` and drops the call),
  so both platforms serialize them in a per-connection `GattOperationQueue` (ADR 0006).
- Write without response: CoreBluetooth delivers no callback for `.withoutResponse`, so iOS
  completes when the data is handed to the stack; Android still calls `onCharacteristicWrite`
  for `WRITE_TYPE_NO_RESPONSE`, confirming local transmission only. The promise means the same
  thing on both: the stack accepted the write.
- Android's read and write callbacks changed shape in API 33 (`onCharacteristicRead` gained a
  `value` parameter, `writeCharacteristic(characteristic, value, writeType)` replaced setting
  the value on the characteristic); `DeviceConnection` uses the new overloads on 33+ and the
  deprecated ones below.
- Bytes: `Data` on iOS, a signed `ByteArray` on the JVM; both cross the bridge as `number[]`
  in `0..255`.
- Subscribing: CoreBluetooth's `setNotifyValue(_:for:)` writes the Client Characteristic
  Configuration descriptor itself and answers through `didUpdateNotificationStateFor`;
  Android's `setCharacteristicNotification` only routes callbacks locally, so
  `DeviceConnection` writes the descriptor (`0x2902`) explicitly and waits for
  `onDescriptorWrite`. Both go through the GATT queue and the promise means the same thing on
  both: the peripheral acknowledged the change (ADR 0007).
- Notification or indication: iOS decides inside `setNotifyValue`; Android encodes the choice
  in the descriptor value (`NotificationDescriptorMapper`: notification when `notify` is
  offered, indication only when `indicate` is offered alone). Both stacks acknowledge
  indications themselves; the app sees one `characteristic.value_changed` either way.
- Value delivery: CoreBluetooth reports read results and notifications through the same
  `didUpdateValueFor`, told apart by whether a read is pending for that characteristic;
  Android has a dedicated `onCharacteristicChanged`, which gained a `value` parameter in API
  33 like the read callback. Both stamp the value natively before emitting it.
- Subscriptions end with the link on both platforms without a per-characteristic callback
  (CoreBluetooth forgets `isNotifying`, Android's descriptor state dies with the closed
  client), so JavaScript drops them when the connection leaves `ready` rather than asking.

## Monorepo mechanics

- yarn 1 workspaces hoist dependencies to the repo root.
- Metro watches the repo root and resolves from both `apps/mobile/node_modules` and the root.
- Gradle resolves `react-native`, `@react-native/codegen`, `hermes-compiler` (the prebuilt
  Hermes compiler used for release bundles) and the RN Gradle plugin through Node
  (`require.resolve`) instead of hard-coded `../node_modules` paths.
- The Podfile already resolves `react_native_pods.rb` through Node.
- One root `tsconfig.json`, `eslint.config.js`, `babel.config.js`, and a Jest `projects` config
  cover every workspace.
