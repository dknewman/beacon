# Beacon

Cross platform Bluetooth Low Energy device manager and developer utility for iOS and Android.

React Native and TypeScript drive the application layer. Bluetooth itself lives in native code:
Swift and CoreBluetooth on iOS, Kotlin and the Android Bluetooth LE APIs on Android. The two meet
through a narrow, codegen-typed Turbo Module whose every payload is validated at runtime before
it reaches application state.

> Status: **Milestone M0 (Foundation)** is implemented. See [Milestone status](#milestone-status)
> for exactly what has and has not been validated.

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
- `createNativeBluetoothAdapterClient` wraps the raw module, validates every value with zod
  schemas from `@beacon/validation`, converts rejections to `BleError`, and folds native events
  into the `NativeBleEvent` discriminated union.
- Native state is authoritative. JavaScript mirrors it through validated events and never infers
  adapter or connection state from local booleans.

## iOS CoreBluetooth

`apps/mobile/ios/BeaconBluetooth/`

- `BluetoothManager.swift` owns `CBCentralManager` on a private serial queue, defers creation
  until JavaScript first asks (creation triggers the permission prompt), and guarantees that a
  state request always settles even before CoreBluetooth's first delegate callback.
- `Mapping/BluetoothStateMapper.swift` and `Errors/BleError.swift` are pure and covered by XCTest.
- `BeaconBluetoothModule.mm` is a thin Objective-C++ class conforming to the generated spec and
  forwarding to Swift. It contains no Bluetooth logic.

## Android BLE

`apps/mobile/android/app/src/main/java/com/beacon/bluetooth/`

- `BluetoothController.kt` owns `BluetoothManager`/`BluetoothAdapter`, reports "unsupported" on
  devices without a BLE radio, and observes `ACTION_STATE_CHANGED` broadcasts.
- `mapping/BluetoothStateMapper.kt` and `errors/BleError.kt` are pure and covered by JUnit.
- `BeaconBluetoothModule.kt` extends the generated `NativeBeaconBluetoothSpec`, starts and stops
  the controller with the module lifecycle, and emits typed events.

## GATT Inspector, Protocol Parsers, Session Recording

Not yet implemented. They are scheduled as milestones M4, M7 and M8 in PROJECT.md. The shared
domain models (`GattService`, `BlePacket`, `BleSession`) already exist in `@beacon/ble-contracts`
so the native, validation and UI layers grow against one vocabulary.

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

Planned for M10 (`MockBleClient` with heart rate, battery and weight scale peripherals and
failure scenarios). Today the app's composition root already injects the client through
context, and tests use `FakeBluetoothAdapterClient`, so swapping in the mock requires no UI
changes.

## Tech Stack

| Layer      | Choice                                                                           |
| ---------- | -------------------------------------------------------------------------------- |
| App        | React Native 0.87 (New Architecture), React 19, TypeScript 6                     |
| Bridge     | Turbo Native Module with codegen, typed event emitters                           |
| Validation | zod 4                                                                            |
| iOS        | Swift 5, CoreBluetooth, minimum iOS 15.1                                         |
| Android    | Kotlin 2.2, Android BLE APIs, minSdk 24, target 36                               |
| Tooling    | yarn 1 workspaces, ESLint 9, Prettier 3, Jest 29, RNTL 14                        |
| CI         | GitHub Actions: typecheck, lint, tests, Android build + tests, iOS build + tests |

## Running Locally

Requirements: Node 22.11+, yarn 1.22, Xcode 16+ with CocoaPods (iOS), Android Studio with SDK 37,
NDK 27 and JDK 17+ (Android).

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
│       ├── app/                 composition root (App, bootstrap)
│       ├── components/          presentational, accessible building blocks
│       ├── features/bluetooth/  adapter state reducer, hook, screen
│       ├── native/              Turbo Module spec + validated client wrapper
│       └── theme/
├── packages/
│   ├── ble-contracts/           domain models, state unions, errors, bridge contract, UUIDs
│   └── validation/              zod schemas + parse helpers for the native boundary
├── docs/                        architecture, state model, bridge, permissions, testing, ADRs
├── scripts/ios/                 Xcode project sync (xcodeproj gem)
└── .github/workflows/ci.yml
```

## Technical Decisions

- [ADR 0001](docs/ADR/0001-react-native-with-native-ble-core.md): React Native UI with a native BLE core; no third party JS BLE engine.
- [ADR 0002](docs/ADR/0002-native-bridge-contract.md): codegen Turbo Module with per-event typed emitters and runtime validation on the JS side.
- [ADR 0003](docs/ADR/0003-monorepo-workspace-layout.md): yarn workspaces monorepo with node-resolved native build paths.

## Milestone status

| Milestone                          | Status                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 Foundation                      | Implemented, native builds **not yet validated** | Typecheck, lint, Jest (74 tests) pass locally. Kotlin sources compile and JUnit tests pass against the real `react-android` 0.87.1 and Android 14 framework classes on the JVM. The full Android Gradle build, the iOS build, and XCTest have **not** been run: the development container has no Android SDK or Xcode. CI is configured to run them. No hardware validation has been performed. |
| M1 Bluetooth state and permissions | Not started                                      | Adapter state API and settings guidance exist in M0; permission abstraction is pending.                                                                                                                                                                                                                                                                                                         |
| M2 and later                       | Not started                                      |                                                                                                                                                                                                                                                                                                                                                                                                 |

## Roadmap

Milestones M1 through M13 are specified in [PROJECT.md](./PROJECT.md#44-development-milestones).
