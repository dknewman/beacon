# Architecture

Beacon is a monorepo with one React Native application and shared TypeScript packages. The
guiding constraint is PROJECT.md section 3: Bluetooth logic lives in native platform code; React
Native consumes a narrow typed bridge; state is explicit.

## Layers

| Layer          | Location                                                               | Owns                                                                                   | Must not                                 |
| -------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| UI             | `apps/mobile/src/features/**/*Screen.tsx`, `src/components`            | Rendering, accessibility, user intent                                                  | Call the bridge directly, hold BLE state |
| Application    | `apps/mobile/src/features/**` (reducers, hooks, coordinators)          | Explicit state machines, orchestration, buffering                                      | Import platform APIs                     |
| Contracts      | `packages/ble-contracts`                                               | Domain models, state unions, error codes, `NativeBleClient` segments, `NativeBleEvent` | Depend on React Native                   |
| Validation     | `packages/validation`                                                  | zod schemas for every boundary payload, `ValidationResult`                             | Know about UI                            |
| Bridge wrapper | `apps/mobile/src/native`                                               | Codegen spec, `createNativeBleClient`, dependency injection context, mock client       | Contain BLE policy                       |
| Native         | `apps/mobile/ios/BeaconBluetooth`, `apps/mobile/android/.../bluetooth` | CoreBluetooth / BluetoothGatt, GATT queue, event emission, error mapping               | Trust JS for connection state            |

Dependency direction is strictly downward in the table. `packages/*` never import from
`apps/mobile`.

## Data flow (M0–M2)

```text
DeviceListScreen
   │ useBluetoothReadiness()                 useScanCoordinator(readiness)
   ▼                                          ▼
adapter + permission reducers ──► readiness ──► scanReducer + deviceCache ──► filters ──► FlatList
   ▲                                              ▲
   │ BluetoothAdapterApi / PermissionApi          │ ScanApi + scan.device_discovered / ble.error
createNativeBleClient
   │ parseBluetoothState / parseBlePermissionState / parseNativeBleEvent (zod)
   │        ← invalid → BleError("invalid_payload") / ble.error event
   ▼
NativeBeaconBluetooth (Turbo Module spec, codegen)
   │
   ├─ iOS: BeaconBluetoothModule.mm → BluetoothManager.swift → CBCentralManager (+ AdvertisementMapper)
   └─ Android: BeaconBluetoothModule.kt → BluetoothController.kt / BleScanner.kt → BluetoothAdapter / BluetoothLeScanner
```

Ordering rule: subscribe to events before the initial read so a transition during the read is
not lost. Late results after unmount are ignored by an `active` flag in the effect. The scan
coordinator is the only caller of `ScanApi`; screens express intent (`start`, `stop`) and read
derived state.

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
`BleClient` (the app's type) is the intersection of the segments implemented so far: adapter,
permission and scan after M2.

## State management

State is separated by responsibility (PROJECT.md 5). M0 introduced the adapter reducer, M1 the
permission reducer and readiness projection, M2 the scan reducer, device cache and in-memory
filters; per-device connection state, sessions, UI state and persisted preferences each get
their own module as their milestones land. There is no global store.

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

## Monorepo mechanics

- yarn 1 workspaces hoist dependencies to the repo root.
- Metro watches the repo root and resolves from both `apps/mobile/node_modules` and the root.
- Gradle resolves `react-native`, `@react-native/codegen`, `hermes-compiler` (the prebuilt
  Hermes compiler used for release bundles) and the RN Gradle plugin through Node
  (`require.resolve`) instead of hard-coded `../node_modules` paths.
- The Podfile already resolves `react_native_pods.rb` through Node.
- One root `tsconfig.json`, `eslint.config.js`, `babel.config.js`, and a Jest `projects` config
  cover every workspace.
