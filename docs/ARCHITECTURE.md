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
| Bridge wrapper | `apps/mobile/src/native`                                               | Codegen spec, `createNativeBluetoothAdapterClient`, dependency injection context       | Contain BLE policy                       |
| Native         | `apps/mobile/ios/BeaconBluetooth`, `apps/mobile/android/.../bluetooth` | CoreBluetooth / BluetoothGatt, GATT queue, event emission, error mapping               | Trust JS for connection state            |

Dependency direction is strictly downward in the table. `packages/*` never import from
`apps/mobile`.

## Data flow (M0)

```text
BluetoothStatusScreen
   │ useBluetoothAdapter()
   ▼
bluetoothAdapterReducer  ◄── native_state_received / native_failed / retry_requested
   ▲
   │ BluetoothAdapterApi (subscribe first, then getBluetoothState)
createNativeBluetoothAdapterClient
   │ parseBluetoothState / parseNativeBleEvent (zod)   ← invalid → BleError("invalid_payload")
   ▼
NativeBeaconBluetooth (Turbo Module spec, codegen)
   │
   ├─ iOS: BeaconBluetoothModule.mm → BluetoothManager.swift → CBCentralManager
   └─ Android: BeaconBluetoothModule.kt → BluetoothController.kt → BluetoothAdapter
```

Ordering rule: subscribe to events before the initial read so a transition during the read is
not lost. Late results after unmount are ignored by an `active` flag in the effect.

## Composition root

`apps/mobile/src/app/bootstrap.tsx` is the only file that references the real Turbo Module. It
creates the validated client and injects it through `BleClientProvider`. Tests render `App` with
`FakeBluetoothAdapterClient`; M10's `MockBleClient` will plug into the same seam.

## Contract segmentation

`NativeBleClient` is composed from `BluetoothAdapterApi`, `ScanApi`, `ConnectionApi` and
`GattApi`. Each milestone ships a complete implementation of one segment in TypeScript, Swift and
Kotlin, rather than stubbing unimplemented methods with fake successes.

## State management

State is separated by responsibility (PROJECT.md 5). M0 introduces the adapter state reducer;
scan state, per-device connection state, the device cache, sessions, UI state and persisted
preferences each get their own module as their milestones land. There is no global store.

## Platform differences

Handled explicitly in native code and documented at the contract:

- `BluetoothState.unauthorized` is a native adapter state on iOS only; Android expresses it as a
  permission result.
- `BluetoothState.resetting` is iOS only; Android's transitional turning on/off states are
  reported as `powered_off`.
- Device identifiers are `CBPeripheral.identifier` UUIDs on iOS and MAC addresses on Android and
  are not portable across devices.
- UUID formatting differs; `normalizeUuid` produces one canonical form at the boundary.

## Monorepo mechanics

- yarn 1 workspaces hoist dependencies to the repo root.
- Metro watches the repo root and resolves from both `apps/mobile/node_modules` and the root.
- Gradle resolves `react-native`, `@react-native/codegen`, `hermes-compiler` (the prebuilt
  Hermes compiler used for release bundles) and the RN Gradle plugin through Node
  (`require.resolve`) instead of hard-coded `../node_modules` paths.
- The Podfile already resolves `react_native_pods.rb` through Node.
- One root `tsconfig.json`, `eslint.config.js`, `babel.config.js`, and a Jest `projects` config
  cover every workspace.
