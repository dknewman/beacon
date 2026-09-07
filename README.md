# Beacon

[![CI](https://github.com/dknewman/beacon/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dknewman/beacon/actions/workflows/ci.yml)

Cross platform Bluetooth Low Energy device manager and developer utility for iOS and Android.

React Native and TypeScript drive the application layer. Bluetooth itself lives in native code:
Swift and CoreBluetooth on iOS, Kotlin and the Android Bluetooth LE APIs on Android. The two meet
through a narrow, codegen-typed Turbo Module whose every payload is validated at runtime before
it reaches application state.

> Status: **M0 (Foundation)**, **M1 (Bluetooth state and permissions)**, **M2 (Device
> scanning)**, **M3 (Connection lifecycle)**, **M4 (GATT discovery)**, **M5 (Characteristic
> read and write)**, **M6 (Notifications and indications)**, **M7 (Protocol parsers)** and
> **M8 (Session recording)** are implemented. See [Milestone status](#milestone-status) for
> exactly what has and has not been validated, on which hardware.

## What It Is

Beacon discovers nearby BLE peripherals, connects to them, inspects GATT services and
characteristics, subscribes to notifications, reads and writes values, records sessions, and
visualizes live device data. It is built to make invisible Bluetooth activity visible: scan
events, connection transitions, raw bytes, parsed values, RSSI, errors, and timing.

## Why I Built It

To demonstrate senior level mobile engineering on a problem where the platforms genuinely differ
and where JavaScript cannot be the source of truth. BLE forces explicit state machines,
serialized native operations, careful lifecycle handling, and typed boundaries. The full product
and engineering specification is in [PROJECT.md](./PROJECT.md).

## Architecture

```text
┌───────────────────────────────────────┐
│  React Native UI (TypeScript)         │  apps/mobile/src/features, components
└───────────────────┬───────────────────┘
                    │ typed hooks / context
┌───────────────────▼───────────────────┐
│  Application layer                    │  apps/mobile/src/features/*/  (reducers, coordinators)
└───────────────────┬───────────────────┘
                    │ BluetoothAdapterApi … NativeBleClient   (packages/ble-contracts)
┌───────────────────▼───────────────────┐
│  Bridge wrapper + runtime validation  │  apps/mobile/src/native, packages/validation (zod)
└───────────────────┬───────────────────┘
                    │ Turbo Module spec (codegen)           apps/mobile/src/native/specs
          ┌─────────┴─────────┐
┌─────────▼───────┐   ┌───────▼─────────┐
│ iOS             │   │ Android         │
│ ObjC++ shim →   │   │ Kotlin module → │
│ Swift           │   │ Kotlin          │
│ BluetoothManager│   │ BluetoothCtrl   │
│ CoreBluetooth   │   │ BluetoothGatt   │
└─────────────────┘   └─────────────────┘
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/NATIVE_BRIDGE.md](docs/NATIVE_BRIDGE.md), [docs/BLE_STATE_MODEL.md](docs/BLE_STATE_MODEL.md),
[docs/PERMISSIONS.md](docs/PERMISSIONS.md), [docs/TESTING.md](docs/TESTING.md),
[docs/SECURITY.md](docs/SECURITY.md), decisions in [docs/ADR](docs/ADR).

## React Native / Native Boundary

- The only bridge surface is `apps/mobile/src/native/specs/NativeBeaconBluetooth.ts`, a codegen
  spec using primitives, plain objects, promises and typed event emitters.
- `createNativeBleClient` wraps the raw module, validates every value with zod schemas from
  `@beacon/validation`, converts rejections to `BleError`, and folds native events into the
  `NativeBleEvent` discriminated union.
- Permission is part of the contract (`PermissionApi`): the UI derives one "readiness" state
  from adapter state and permission together and shows a single next action (ask, open
  settings, retry). See [docs/PERMISSIONS.md](docs/PERMISSIONS.md).
- Native state is authoritative. JavaScript mirrors it through validated events and never infers
  adapter or connection state from local booleans.
- Scanning (`ScanApi`) is driven by a scan coordinator that owns an explicit
  `idle | starting | scanning | stopping | failed` machine and a device cache. Native reports
  throttled advertisements; the cache deduplicates by id, smooths RSSI, hides devices not seen
  for 10 s, and the list filters by name, service UUID and signal strength in memory. See
  [ADR 0004](docs/ADR/0004-scan-duplicates-and-device-cache.md).
- Connections (`ConnectionApi`) are driven by a connection coordinator with one explicit
  per-device machine (`disconnected | connecting | connected | discovering_services | ready |
disconnecting | failed`) mirrored from native events. `connect()` resolves at `ready`,
  JavaScript owns the 15 s timeout and cancels natively on expiry, and errors always precede
  the `disconnected` they cause so the reason survives. See
  [ADR 0005](docs/ADR/0005-navigation-and-connection-promise-semantics.md).
- GATT discovery (`GattDiscoveryApi`) returns the table native discovered while connecting.
  Every UUID is normalized and every property checked against the contract before the table
  reaches the GATT inspector, which labels services and characteristics from the known UUID
  registry (`@beacon/ble-contracts`, PROJECT.md 34).
- Reads and writes (`GattValueApi`) carry values as plain `number[]` in `0..255`; the wrapper
  validates every read result and flattens the write request (`mode` becomes the
  `withResponse` boolean) onto scalar spec arguments. Native serializes GATT operations per
  peripheral in a pure `GattOperationQueue` and rejects everything queued with `disconnected`
  when the link ends. See [ADR 0006](docs/ADR/0006-gatt-operation-queue-and-packet-log.md).
- Notifications and indications (`GattNotifyApi`) use one `setNotify(request)` whose promise
  resolves only once the peripheral acknowledged the change (`didUpdateNotificationStateFor`
  on iOS, the Client Characteristic Configuration descriptor write on Android), queued behind
  the other GATT operations. Values arrive one per `characteristic.value_changed` event,
  timestamped natively at receipt and validated by the wrapper, and are buffered in the
  application layer so the screen renders at most ten times a second. With this segment
  `BleClient` is the whole `NativeBleClient` contract. See
  [ADR 0007](docs/ADR/0007-buffered-notification-pipeline.md).
- Session recording adds no bridge segment. The coordinators publish what they learn from
  the bridge (connection transitions, errors, RSSI, discovery, reads, writes, subscription
  changes, notifications) on an in-process activity bus, and the session recorder persists
  it to SQLite behind a repository boundary; the database is a second native dependency
  (`@op-engineering/op-sqlite`) that the application layer only reaches through a
  three-method `SqlDatabase` interface. See
  [ADR 0009](docs/ADR/0009-session-persistence.md).

## iOS CoreBluetooth

`apps/mobile/ios/BeaconBluetooth/`

- `BluetoothManager.swift` owns `CBCentralManager` on a private serial queue. Because creating
  the central triggers the system permission prompt, it is only created once authorization is
  granted or inside an explicit `requestPermission()`; app launch never prompts. A state request
  always settles even before CoreBluetooth's first delegate callback.
- Scanning uses `scanForPeripherals(withServices:options:)` with duplicates allowed so RSSI keeps
  updating, throttled to one event per peripheral per 300 ms before crossing the bridge. Service
  UUID filters are validated before `CBUUID` sees them, so a bad filter is a rejection, not a
  crash. CoreBluetooth drops the scan when the radio leaves `poweredOn`; the manager mirrors that
  and JavaScript stops the coordinator from the adapter event.
- `PeripheralSession.swift` retains one `CBPeripheral`, is its delegate through a private
  proxy, and holds the completions waiting on it. `BluetoothManager` connects, discovers
  services after `didConnect`, completes at `ready`, and reports failures and remote
  disconnects as errors before the `disconnected` transition. Peripherals seen by the scanner
  are retained so they can be connected later. A link reports `ready` only after every service's
  characteristics have been discovered; the mapped table is cached on the session.
- `GattOperationQueue.swift` serializes GATT operations per peripheral without depending on
  CoreBluetooth: `PeripheralSession` enqueues `readValue(for:)` and `writeValue(_:for:type:)`
  after checking the characteristic's properties, finishes the queue from `didUpdateValueFor`
  and `didWriteValueFor` (a `.withoutResponse` write completes as soon as the stack accepted
  it), and cancels it when the link ends so every waiting completion is rejected with
  `disconnected`.
- Subscriptions go through the same queue: `BluetoothManager.setNotify` checks `.notify` /
  `.indicate`, enqueues `setNotifyValue(_:for:)`, and `didUpdateNotificationStateFor` settles
  the completion and finishes the queue. `PeripheralSession` keeps the pending change and the
  set of subscribed characteristics, taken from the peripheral's own `isNotifying` answers; a
  `didUpdateValueFor` with no read pending for that characteristic is a notification and is
  emitted through `CharacteristicValueMapper` with canonical UUIDs and an ISO-8601 timestamp
  taken on the CoreBluetooth queue. The link ending clears the set, because CoreBluetooth
  drops subscriptions with the connection.
- `Mapping/BluetoothStateMapper.swift`, `Mapping/AuthorizationMapper.swift`,
  `Mapping/AdvertisementMapper.swift` (advertisement dictionary → `BleDevice` shape, hex and
  ISO-8601 encoding), `Mapping/ConnectionStateMapper.swift`, `Mapping/GattMapper.swift`
  (property option set → wire values, canonical UUIDs for characteristic lookups),
  `Mapping/ByteArrayMapper.swift` (`[NSNumber]` ⇄ `Data` with range validation),
  `Mapping/CharacteristicValueMapper.swift` (pushed value → event payload, subscription keys)
  and `Errors/BleError.swift` are pure and covered by XCTest.
- `BeaconBluetoothModule.mm` is a thin Objective-C++ class conforming to the generated spec and
  forwarding to Swift. It contains no Bluetooth logic.

## Android BLE

`apps/mobile/android/app/src/main/java/com/beacon/bluetooth/`

- `BluetoothController.kt` owns `BluetoothManager`/`BluetoothAdapter`, reports "unsupported" on
  devices without a BLE radio, and observes `ACTION_STATE_CHANGED` broadcasts.
- `permissions/PermissionController.kt` requests only what the running API level needs
  (`BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` on 31+, fine location below) and tells "denied" from
  "blocked" using the rationale flag plus a persisted "asked before" bit.
- `scanning/BleScanner.kt` owns `BluetoothLeScanner`: it checks permission, radio state and
  filter UUIDs before starting (contract errors instead of platform exceptions), throttles
  discoveries per address, and turns `onScanFailed` into a `scan_failed` event with the platform
  code preserved, including the "5 scans per 30 seconds" throttle Android applies.
- `connection/DeviceConnection.kt` owns one `BluetoothGatt` and its callback, drives the
  connection machine under the instance lock (callbacks arrive on a binder thread), discovers
  services after the link comes up, and closes the client on every exit path.
  `connection/ConnectionRegistry.kt` keeps one connection per address behind shared pre-flight
  checks. `mapping/GattStatusMapper.kt` turns status codes (133, 8, 19, 22, 62) into contract
  errors with the platform status preserved.
- `connection/GattOperationQueue.kt` serializes GATT operations per connection without an
  Android dependency: `DeviceConnection` enqueues `readCharacteristic` and `writeCharacteristic`
  (`WRITE_TYPE_DEFAULT` / `WRITE_TYPE_NO_RESPONSE`, the API 33 value-carrying overloads on new
  devices and the deprecated value-setting path below) after checking the property bits,
  finishes the queue from `onCharacteristicRead` (both the API 33 and the legacy signature) and
  `onCharacteristicWrite`, and cancels it on close so every waiting promise is rejected with
  `disconnected`.
- `connection/DeviceConnection.setNotify` calls `setCharacteristicNotification` (local
  routing only) and then writes the Client Characteristic Configuration descriptor (`0x2902`)
  through the queue with `ENABLE_NOTIFICATION_VALUE`, `ENABLE_INDICATION_VALUE` (only when
  the characteristic lacks `notify`) or `DISABLE_NOTIFICATION_VALUE`, answered by
  `onDescriptorWrite`, which records the acknowledged subscription or flips the local switch
  back on a refusal; a characteristic without the descriptor is refused with
  `subscription_failed`. `onCharacteristicChanged` (the API 33 overload carrying the value and the legacy
  one) emits the value event stamped with `IsoTimestamp`, and the link ending clears the
  connection's subscriptions.
- `mapping/BluetoothStateMapper.kt`, `mapping/ConnectionStateMapper.kt`,
  `mapping/GattStatusMapper.kt`, `mapping/GattTreeMapper.kt` (property bitmask → wire values,
  tree snapshot), `mapping/ByteArrayMapper.kt` (bridge doubles ⇄ signed `ByteArray` with range
  validation, unsigned on the way out), `mapping/NotificationDescriptorMapper.kt` (property
  bits → CCCD value, `CCCD_UUID`), `mapping/ScanResultMapper.kt` (manufacturer data re-serialized
  with the little-endian company id so it matches iOS), `mapping/BleUuid.kt`,
  `mapping/ScanFailureMapper.kt`, `mapping/IsoTimestamp.kt`, `permissions/PermissionStateMapper.kt`,
  `permissions/RequiredPermissions.kt` and `errors/BleError.kt` are pure and covered by JUnit.
- `BeaconBluetoothModule.kt` extends the generated `NativeBeaconBluetoothSpec`, starts and stops
  the controller, scanner and connections with the module lifecycle, and emits typed events.

## GATT Inspector

`apps/mobile/src/features/gatt/`: `GattProvider` keeps one discovered table per connected device
and drops it with the link; `GattInspectorScreen` lists services and characteristics with names
from the known UUID registry and the characteristic properties; `CharacteristicDetailScreen`
shows identity and properties and the read, write and subscribe controls described below,
each offered only for a property the characteristic advertises and enabled only while the
link is `ready`.

## Characteristic Read and Write

`apps/mobile/src/features/gatt/` and `apps/mobile/src/features/packets/`: the characteristic
screen offers Read when the characteristic advertises `read` and a write form when it
advertises `write` or `write_without_response`, each enabled only while the link is `ready` and
no other operation is in flight (`useCharacteristicOperations`, one operation at a time with an
`idle | reading | writing` state and a "Last operation" row that names the contract code when
something fails). The write form takes HEX, decimal or UTF-8 text, parses it on every keystroke
into a validation message or a byte preview, and offers "Write with response" and "Write
without response" per the properties. The latest value is shown in HEX, DECIMAL, BINARY, ASCII
and UTF-8 columns (`ValueColumns`; the codec in `@beacon/ble-contracts` is hand written
because Hermes has no `TextDecoder`). Every successful read lands as an incoming packet and
every successful write as an outgoing one in `PacketLogProvider`, a per-device ring buffer of
500 packets above navigation that the screen lists (latest 20) and that the packet inspector,
the protocol parsers and the M8 recorder share. Failures are reported, not logged.

## Notifications and Indications

`apps/mobile/src/features/subscriptions/`: the characteristic screen offers Subscribe when the
characteristic advertises `notify` or `indicate`, enabled only while the link is `ready`, and
Unsubscribe once the peripheral has acknowledged the subscription ("Subscribing…" /
"Unsubscribing…" while `setNotify` is in flight). A "Notifications" row shows the phase and
how many values have arrived ("On", "3 notifications received."), and the value card says when
the latest one was received. `SubscriptionProvider` holds one entry per characteristic above
navigation (`off | subscribing | on | unsubscribing`, count, last value time, last error),
mirrored from native acknowledgements rather than from the request, and drops every entry of
a device when its connection leaves `ready`, because native drops the subscriptions with the
link. Incoming values are timestamped natively at receipt and buffered in JavaScript: at most
every 100 ms the provider flushes them as one batch into the packet log and one count update
per characteristic, so a 100 Hz stream re-renders the screen at most ten times a second
(PROJECT.md 17, 37) and the value columns and packet list update from the same batched log as
reads and writes. Native picks a notification when the characteristic offers
one and an indication only when that is all it offers; a characteristic with neither is
refused with "Notifications not supported". A failed subscription is reported in the row, not
logged as a packet. See [ADR 0007](docs/ADR/0007-buffered-notification-pipeline.md).

## Protocol Parsers

`packages/protocol-parsers` and `apps/mobile/src/features/parsers/`: the characteristic
screen shows a parsed reading of the latest value above the HEX, DECIMAL, BINARY, ASCII and
UTF-8 columns (label, one-line summary, then every field with its unit) and a one-line
summary on each packet row, so a heart rate strap reads "Heart rate, 80 bpm" with sensor
contact, energy expended and RR intervals underneath, and a Device Name reads as text. The
parsers live in their own workspace package with no UI imports (PROJECT.md 19): a
bounds-checked little-endian `ByteReader` with the SIG scalar types (IEEE 11073 SFLOAT with
its special values, the seven-byte Date Time), one `BleParser` per characteristic matched on
its canonical UUID (Battery Level `2A19`, Heart Rate Measurement `2A37`, Weight Measurement
`2A9D`, Blood Pressure Measurement `2A35`, UTF-8 text for the SIG string characteristics and
the Nordic UART lines) and a raw-bytes parser that matches everything and never fails.
`createParserRegistry` consults them in order, first match wins, with the raw fallback last;
`parse` takes the bridge's `number[]`, hands the parser a `Uint8Array` and returns an
outcome, never throws: a malformed value yields `{ ok: false, parserId, reason, fallback }`
with the raw reading standing in, and the screen names the parser and the reason ("Missing
heart rate: needed 2 byte(s) at offset 1, 1 left") so a non-conformant peripheral is shown
rather than hidden. Every parser result is validated by a zod schema before it is handed on,
as PROJECT.md asks for parser output. The parsers follow the Bluetooth SIG characteristic
definitions and are tested with spec-shaped vectors; the mock scale and blood pressure
monitor emit spec-shaped measurements, and a test asserts every scripted notifier parses with
a non-raw parser. Parsing is stateless and derived from the packet log at render time, so M7
adds no state machine and no native code. See
[ADR 0008](docs/ADR/0008-parser-registry.md).

## Session Recording

`apps/mobile/src/features/sessions/`, `apps/mobile/src/features/activity/` and
`apps/mobile/src/storage/`: the device detail screen gains a Session row ("Not recording",
"Starting", "Recording" with live event and packet counts, "Stopping"), one button that is
Start session while idle and Stop session while recording, and a link to this device's
session history; the device list gains a Sessions link to all of them. A session is explicit: it records
everything that happens on that device's link between the two taps (connection transitions,
errors including the connect timeout, RSSI readings, service discovery, reads, writes,
subscription changes and every notification with its native timestamp), and a link that
drops and reconnects while recording stays in one session. The coordinators publish those
events on an in-process activity bus; `SessionRecorderProvider`, above navigation, is its one
subscriber and keeps a per-device `idle | starting | recording | stopping` machine, captures
from the moment Start is pressed, buffers events in a ref and appends them to the store in
one transaction every 250 ms or at 200 events, in order per device, keeps recording when an
append fails (the batch is dropped and counted), writes what is left before ending, and
closes sessions a previous run left open when the app starts. Sessions live in SQLite on the
device (`@op-engineering/op-sqlite`, `beacon.sqlite`) behind a `SessionRepository` boundary
with an in-memory twin for tests, both running one contract suite; the schema is versioned
with `PRAGMA user_version` from the first migration, each event is one row with a JSON
payload that is validated by the runtime schemas on the way back (invalid rows are
skipped), and the database is opened on first use so a failure to open is a failed
operation, not a crash at launch. Session History lists sessions newest first (device, start,
duration or a Recording badge, packet count), optionally for one device, refetches whenever
the recorder's revision changes or the screen gains focus, and shows Loading, Failed with
Try again, or an empty-state hint; Session Detail shows the statistics (duration, events,
packets, bytes received and sent, notification rate, RSSI average and range) and the busiest
characteristics above a timeline of every event (time, kind, detail, as PROJECT.md 20
sketches it), grows in place while the session is still recording, and can delete an ended
session. Export is M9 and nothing leaves the device yet. See
[ADR 0009](docs/ADR/0009-session-persistence.md).

## Testing

```sh
yarn typecheck      # tsc, strict mode across apps and packages
yarn lint           # eslint 9 flat config, type-aware rules, zero warnings allowed
yarn format:check   # prettier
yarn test           # jest: packages + mobile app (React Native Testing Library)
```

Native unit tests:

```sh
cd apps/mobile/android && ./gradlew :app:testDebugUnitTest
cd apps/mobile/ios && xcodebuild test -workspace Beacon.xcworkspace -scheme Beacon \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

See [docs/TESTING.md](docs/TESTING.md) for the strategy and the mock layer plan.

## Mock BLE Environment

`apps/mobile/src/mock/createMockBleClient.ts` implements the whole client surface with
scripted peripherals (heart rate monitor, weight scale, blood pressure monitor, Nordic UART
device and an unnamed beacon) that advertise on realistic intervals with drifting RSSI, connect
through every transition, answer RSSI reads, serve a scripted GATT table and characteristic
values, store writes so the next read returns them, push notifications and indications on
scripted intervals once subscribed (a drifting heart rate about once a second, a battery level
every few seconds, a weight measurement indication, a blood pressure measurement indication,
Nordic UART TX, every one shaped as its characteristic definition says so the parsers read
it) and stop them with the
link, enforce characteristic properties the way native does, and can be scripted to refuse,
stall or drop a connection or to fail the next read, write or subscription change. It refuses
to scan or connect when the simulated radio is off or permission is missing. Set
`USE_MOCK_BLE_CLIENT` to `true` in `apps/mobile/src/app/runtimeOptions.ts` to run the app
against it on a simulator or without peripherals nearby. It grows into the full M10
environment (remaining failure scenarios) as those segments land. Tests use `FakeBleClient`,
which keeps every native call pending until the test settles it.

## Tech Stack

| Layer      | Choice                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| App        | React Native 0.87 (New Architecture), React 19, TypeScript 6                                                     |
| Bridge     | Turbo Native Module with codegen, typed event emitters                                                           |
| Navigation | React Navigation 7 native stack (react-native-screens)                                                           |
| Validation | zod 4                                                                                                            |
| Storage    | SQLite through op-sqlite 18 (JSI, autolinked); sql.js runs the same SQL under Jest                               |
| iOS        | Swift 5, CoreBluetooth, minimum iOS 15.1                                                                         |
| Android    | Kotlin 2.2, Android BLE APIs, minSdk 24, target 36                                                               |
| Tooling    | yarn 1 workspaces, ESLint 9, Prettier 3, Jest 29, RNTL 14                                                        |
| CI         | GitHub Actions on every PR: typecheck, lint, tests, Android build + JUnit, iOS build + XCTest; Dependabot weekly |

## Running Locally

Requirements: Node 22.11+, yarn 1.22, Xcode 16+ with CocoaPods (iOS), Android Studio with SDK 37,
NDK 27 and JDK 17+ (Android).

iOS signing: the app's bundle identifier is `dev.dknewman.beacon` (set by
`scripts/ios/sync-xcode-project.rb`, which also derives the test bundle's identifier). Select
your team under Signing & Capabilities and Xcode registers the App ID and a managed profile; a
personal Apple ID is enough for running on your own iPhone.

Lockfiles are part of the build contract: `yarn.lock` and `apps/mobile/Gemfile.lock` are
committed, and `apps/mobile/ios/Podfile.lock` must be committed after the first successful
`pod install` so CI and every machine resolve the same pods.

Session recording (M8) adds `@op-engineering/op-sqlite`, a native module on both platforms.
It is autolinked, so Android needs nothing beyond `yarn install`; on iOS run `pod install`
again after pulling so the pod is added to the workspace.

### Trying a build without a development machine

Every CI run uploads `beacon-standalone-apk`, a **release** build (arm64, signed with the
template's debug keystore) with the JavaScript bundle embedded. Download it from the run's
Artifacts section and sideload it. A **debug** build (`yarn android`, `assembleDebug`) does not
embed JavaScript; it loads it from Metro and shows "Unable to load script" when run without
`yarn start` and `adb reverse tcp:8081 tcp:8081`.

```sh
yarn install

# iOS
cd apps/mobile/ios && bundle install && bundle exec pod install && cd ..
yarn ios

# Android
cd apps/mobile && yarn android

# Metro (from apps/mobile)
yarn start
```

## Project Structure

```text
beacon/
├── apps/mobile/                 React Native app (ios/, android/, src/)
│   └── src/
│       ├── app/                 composition root (App, bootstrap), navigation stack
│       ├── components/          presentational, accessible building blocks
│       ├── features/bluetooth/  adapter + permission machines, readiness panel
│       ├── features/scan/       scan coordinator, device cache, filters, device list screen
│       ├── features/connection/ connection coordinator, per-device machine, device detail screen
│       ├── features/gatt/       GATT table provider, inspector and characteristic screens, read/write operations
│       ├── features/packets/    per-device packet log (ring buffer) and packet row presentation
│       ├── features/subscriptions/ per-characteristic subscriptions and the buffered value pipeline
│       ├── features/parsers/    parsed value of a packet (registry glue) and its view
│       ├── features/activity/   activity bus: what the coordinators publish, what the recorder records
│       ├── features/sessions/   session repository (in-memory, SQLite), recorder machine and provider, statistics, history and detail screens
│       ├── storage/             SqlDatabase interface, op-sqlite binding, versioned migrations
│       ├── mock/                scripted mock BLE client (runtime option)
│       ├── native/              Turbo Module spec + validated client wrapper
│       └── theme/
│   └── tests/                   App integration tests, FakeBleClient, sql.js-backed SqlDatabase for Jest
├── packages/
│   ├── ble-contracts/           domain models, state unions, errors, bridge contract, UUIDs, known UUID registry, byte codecs, parser types
│   ├── validation/              zod schemas + parse helpers for the native boundary and parser output
│   └── protocol-parsers/        byte reader, SIG characteristic parsers, UTF-8 and raw parsers, parser registry
├── docs/                        architecture, state model, bridge, permissions, testing, ADRs
├── scripts/ios/                 Xcode project sync (xcodeproj gem)
└── .github/workflows/ci.yml
```

## Technical Decisions

- [ADR 0001](docs/ADR/0001-react-native-with-native-ble-core.md): React Native UI with a native BLE core; no third party JS BLE engine.
- [ADR 0002](docs/ADR/0002-native-bridge-contract.md): codegen Turbo Module with per-event typed emitters and runtime validation on the JS side.
- [ADR 0003](docs/ADR/0003-monorepo-workspace-layout.md): yarn workspaces monorepo with node-resolved native build paths.
- [ADR 0004](docs/ADR/0004-scan-duplicates-and-device-cache.md): request duplicate advertisements, throttle natively, deduplicate and smooth in the application-layer device cache.
- [ADR 0005](docs/ADR/0005-navigation-and-connection-promise-semantics.md): React Navigation native stack above the coordinators; `connect()` resolves at `ready`; JavaScript owns the connection timeout.
- [ADR 0006](docs/ADR/0006-gatt-operation-queue-and-packet-log.md): pure per-connection GATT operation queue in native; one operation at a time from the UI; bounded packet log above navigation; bytes as `number[]` across the bridge.
- [ADR 0007](docs/ADR/0007-buffered-notification-pipeline.md): notifications timestamped natively, buffered in JavaScript and flushed at most every 100 ms into one packet-log batch; subscriptions mirrored from native acknowledgements and dropped with the link; Android writes the CCCD itself; notification when offered, indication only otherwise.
- [ADR 0008](docs/ADR/0008-parser-registry.md): parsers in their own workspace package with no UI imports; `number[]` in, `Uint8Array` to the parsers; first-match ordered registry with a raw fallback that always succeeds; failures are outcomes, not exceptions; output validated by schema; parsers follow the SIG characteristic definitions rather than the illustrative PROJECT.md example.
- [ADR 0009](docs/ADR/0009-session-persistence.md): sessions in SQLite through op-sqlite behind a `SessionRepository` boundary with an in-memory twin and one contract suite; `user_version` migrations from the first release; one JSON payload per event, validated on the way back; sql.js runs the same SQL under Jest; an in-process activity bus and a buffered, per-device serialized recorder as the single write path; sessions explicit and not tied to the link; open sessions closed on the next launch; the database opened lazily.

## Milestone status

| Milestone                          | Status                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0 Foundation                      | Implemented, CI green, **launched on an iPhone**      | Typecheck, lint and Jest pass. CI builds the release APK and runs the Kotlin JUnit tests; CI builds the iOS app and runs the Swift XCTests on a simulator. The iOS app was built from Xcode and launched on a physical iPhone (Debug configuration, New Architecture, embedded bundle): the home screen rendered. Android has not yet been launched on a device by a person.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| M1 Bluetooth state and permissions | Implemented, **partially validated on an iPhone**     | `PermissionApi` on the bridge; iOS authorization mapping with the prompt deferred to an explicit user action; Android runtime requests scoped by API level with denied/blocked distinction; permission state machine, readiness derivation and settings guidance in the UI; Jest, XCTest and JUnit coverage. Observed on a physical iPhone: **powered on + permission granted → "Ready"**. Not yet observed by a person: powered off, unauthorized (denied), unsupported, and every Android state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| M2 Device scanning                 | Implemented, CI-validated, **no hardware validation** | `ScanApi` on the bridge with discovery and error emitters; scan coordinator with an explicit scan machine; device cache with deduplication, RSSI smoothing and stale hiding; filters; device list screen; scripted mock scanner; CoreBluetooth scanning with per-peripheral throttling; `BluetoothLeScanner` with pre-flight checks and failure mapping. The M2 gate (start, devices appear, RSSI updates, no duplicate rows, stop, events stop) is exercised by Jest against the fake client and by the mock client's own tests; no person has yet run a scan on a device.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| M3 Connection lifecycle            | Implemented, CI-validated, **no hardware validation** | `ConnectionApi` on the bridge with the connection-state emitter; connection coordinator with one explicit per-device machine mirrored from native, a 15 s timeout owned by JavaScript and errors ordered before the `disconnected` they cause; device detail screen with live RSSI; mock connections that can refuse, stall or drop; `PeripheralSession` on iOS and `DeviceConnection` / `ConnectionRegistry` on Android with status mapping. Every transition, cancellation, timeout and remote drop is exercised by Jest against the fake client; no person has yet connected to a peripheral from a device.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| M4 GATT discovery                  | Implemented, CI-validated, **no hardware validation** | `GattDiscoveryApi` on the bridge; native discovers the whole table while connecting and serves it from cache; UUID normalization and property validation at the boundary; known UUID registry; GATT inspector and characteristic detail screens; `GattMapper` / `GattTreeMapper` covered by XCTest and JUnit. Discovery, failure and the table being dropped with the link are exercised by Jest; no person has yet inspected a real peripheral's table on a device.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| M5 Characteristic read and write   | Implemented, CI-validated, **no hardware validation** | `GattValueApi` on the bridge (`readCharacteristic`, `writeCharacteristic` with and without response, bytes as `number[]`); per-characteristic operation state with one operation in flight; write form with HEX / decimal / UTF-8 input and live validation; HEX, DECIMAL, BINARY, ASCII and UTF-8 value columns; per-device packet log above navigation; mock reads and writes with property enforcement; pure `GattOperationQueue` in Swift and Kotlin with unit tests. Reads, writes, both failure paths and a link dropping mid-operation are exercised by Jest against the fake client; no person has yet read or written a characteristic on a device.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| M6 Notifications and indications   | Implemented, CI-validated, **no hardware validation** | `GattNotifyApi` on the bridge (`setNotify` resolving on the peripheral's acknowledgement, `onCharacteristicValueChanged` with native timestamps); per-characteristic subscription state mirrored from the acknowledgement and dropped with the link; buffered value pipeline flushing at most every 100 ms into one packet-log batch and one count update per characteristic; Subscribe / Unsubscribe control and a Notifications row on the characteristic screen; mock notifiers with property enforcement; `setNotifyValue` on iOS and the CCCD write on Android behind the GATT queue, `NotificationDescriptorMapper` covered by JUnit. Subscribing, unsubscribing, a burst landing as one flush, a refused subscription and the link dropping while subscribed are exercised by Jest against the fake client; no person has yet received a notification from a peripheral on a device.                                                                                                                                                                                                                                                                                                                        |
| M7 Protocol parsers                | Implemented, CI-validated, **no hardware validation** | `@beacon/protocol-parsers` workspace package: bounds-checked `ByteReader` (SFLOAT, Date Time), Battery Level, Heart Rate Measurement, Weight Measurement, Blood Pressure Measurement, UTF-8 text and raw-bytes parsers, first-match registry with the raw fallback and failures returned as outcomes; parser output validated by schema; parsed reading on the characteristic screen and a summary per packet row; mock blood pressure indication and a test that every scripted notifier parses. Pure TypeScript with no native change, so CI's `js` job is the whole check; the parsers are exercised by Jest with spec-shaped vectors, through the fake client and against the mock peripherals. No person has yet seen a real peripheral's value parsed on a device, and whether real hardware sends what the SIG definitions say is still a hardware question.                                                                                                                                                                                                                                                                                                                                                |
| M8 Session recording               | Implemented, CI-validated, **no hardware validation** | SQLite on the device through `@op-engineering/op-sqlite` behind a three-method `SqlDatabase` interface, `user_version` migrations from the first release, `sessions` and `session_events` with one validated JSON payload per event; `SessionRepository` with SQLite and in-memory implementations sharing one contract suite; an activity bus every coordinator publishes to and a per-device session recorder (explicit Start / Stop, capture from the start request, 250 ms / 200-event batched appends serialized per device, failed appends counted, open sessions closed on the next launch); statistics; Session row and control on the device detail screen, a Sessions link on the device list, Session History and Session Detail screens with their presentation text and load state covered by unit tests. The migrations and every repository statement run against a real SQLite engine under Jest through sql.js, and the recorder, the statistics and the screens are exercised by Jest against the fake client and the in-memory repository. The op-sqlite native build is compiled by CI's Android and iOS jobs only; no person has yet recorded a session, or opened the database, on a device. |
| M9 and later                       | Not started                                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Roadmap

Milestones M1 through M13 are specified in [PROJECT.md](./PROJECT.md#44-development-milestones).
