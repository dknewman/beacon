# Beacon

[![CI](https://github.com/dknewman/beacon/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dknewman/beacon/actions/workflows/ci.yml)

Cross platform Bluetooth Low Energy device manager and developer utility for iOS and Android.

React Native and TypeScript drive the application layer. Bluetooth itself lives in native code:
Swift and CoreBluetooth on iOS, Kotlin and the Android Bluetooth LE APIs on Android. The two meet
through a narrow, codegen-typed Turbo Module whose every payload is validated at runtime before
it reaches application state.

> Status: **M0 (Foundation)**, **M1 (Bluetooth state and permissions)**, **M2 (Device
> scanning)**, **M3 (Connection lifecycle)** and **M4 (GATT discovery)** are implemented. See
> [Milestone status](#milestone-status) for exactly what has and has not been validated, on
> which hardware.

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
- `Mapping/BluetoothStateMapper.swift`, `Mapping/AuthorizationMapper.swift`,
  `Mapping/AdvertisementMapper.swift` (advertisement dictionary → `BleDevice` shape, hex and
  ISO-8601 encoding), `Mapping/ConnectionStateMapper.swift`, `Mapping/GattMapper.swift`
  (property option set → wire values) and `Errors/BleError.swift` are pure and covered by XCTest.
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
- `mapping/BluetoothStateMapper.kt`, `mapping/ConnectionStateMapper.kt`,
  `mapping/GattStatusMapper.kt`, `mapping/GattTreeMapper.kt` (property bitmask → wire values,
  tree snapshot), `mapping/ScanResultMapper.kt` (manufacturer data re-serialized
  with the little-endian company id so it matches iOS), `mapping/BleUuid.kt`,
  `mapping/ScanFailureMapper.kt`, `mapping/IsoTimestamp.kt`, `permissions/PermissionStateMapper.kt`,
  `permissions/RequiredPermissions.kt` and `errors/BleError.kt` are pure and covered by JUnit.
- `BeaconBluetoothModule.kt` extends the generated `NativeBeaconBluetoothSpec`, starts and stops
  the controller, scanner and connections with the module lifecycle, and emits typed events.

## GATT Inspector

`apps/mobile/src/features/gatt/`: `GattProvider` keeps one discovered table per connected device
and drops it with the link; `GattInspectorScreen` lists services and characteristics with names
from the known UUID registry and the characteristic properties; `CharacteristicDetailScreen`
shows identity and properties, and states plainly that reads, writes and subscriptions arrive
with M5 and M6 rather than showing dead controls.

## Protocol Parsers, Session Recording

Not yet implemented. They are scheduled as milestones M7 and M8 in PROJECT.md. The shared domain
models (`BlePacket`, `BleSession`) already exist in `@beacon/ble-contracts` so the native,
validation and UI layers grow against one vocabulary.

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

`apps/mobile/src/mock/createMockBleClient.ts` implements the M3 client surface with scripted
peripherals (heart rate monitor, weight scale, blood pressure monitor, Nordic UART device and an
unnamed beacon) that advertise on realistic intervals with drifting RSSI, connect through every
transition, answer RSSI reads, and can be scripted to refuse, stall or drop a connection. It
refuses to scan or connect when the simulated radio is off or permission is missing. Set `USE_MOCK_BLE_CLIENT` to `true` in
`apps/mobile/src/app/runtimeOptions.ts` to run the app against it on a simulator or without
peripherals nearby. It grows into the full M10 environment (connections, GATT, failure
scenarios) as those segments land. Tests use `FakeBleClient`, which keeps every native call
pending until the test settles it.

## Tech Stack

| Layer      | Choice                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| App        | React Native 0.87 (New Architecture), React 19, TypeScript 6                                                     |
| Bridge     | Turbo Native Module with codegen, typed event emitters                                                           |
| Navigation | React Navigation 7 native stack (react-native-screens)                                                           |
| Validation | zod 4                                                                                                            |
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
│       ├── features/gatt/       GATT table provider, inspector and characteristic screens
│       ├── mock/                scripted mock BLE client (runtime option)
│       ├── native/              Turbo Module spec + validated client wrapper
│       └── theme/
├── packages/
│   ├── ble-contracts/           domain models, state unions, errors, bridge contract, UUIDs, known UUID registry
│   └── validation/              zod schemas + parse helpers for the native boundary
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

## Milestone status

| Milestone                          | Status                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 Foundation                      | Implemented, CI green, **launched on an iPhone**      | Typecheck, lint and Jest pass. CI builds the release APK and runs the Kotlin JUnit tests; CI builds the iOS app and runs the Swift XCTests on a simulator. The iOS app was built from Xcode and launched on a physical iPhone (Debug configuration, New Architecture, embedded bundle): the home screen rendered. Android has not yet been launched on a device by a person.                                                                                                                                                                                                |
| M1 Bluetooth state and permissions | Implemented, **partially validated on an iPhone**     | `PermissionApi` on the bridge; iOS authorization mapping with the prompt deferred to an explicit user action; Android runtime requests scoped by API level with denied/blocked distinction; permission state machine, readiness derivation and settings guidance in the UI; Jest, XCTest and JUnit coverage. Observed on a physical iPhone: **powered on + permission granted → "Ready"**. Not yet observed by a person: powered off, unauthorized (denied), unsupported, and every Android state.                                                                          |
| M2 Device scanning                 | Implemented, CI-validated, **no hardware validation** | `ScanApi` on the bridge with discovery and error emitters; scan coordinator with an explicit scan machine; device cache with deduplication, RSSI smoothing and stale hiding; filters; device list screen; scripted mock scanner; CoreBluetooth scanning with per-peripheral throttling; `BluetoothLeScanner` with pre-flight checks and failure mapping. The M2 gate (start, devices appear, RSSI updates, no duplicate rows, stop, events stop) is exercised by Jest against the fake client and by the mock client's own tests; no person has yet run a scan on a device. |
| M3 and later                       | Not started                                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Roadmap

Milestones M1 through M13 are specified in [PROJECT.md](./PROJECT.md#44-development-milestones).
