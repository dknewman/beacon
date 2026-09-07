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
| Validation     | `packages/validation`                                                             | zod schemas for every boundary payload, `ValidationResult`                             | Know about UI                            |
| Bridge wrapper | `apps/mobile/src/native`                                                          | Codegen spec, `createNativeBleClient`, dependency injection context, mock client       | Contain BLE policy                       |
| Native         | `apps/mobile/ios/BeaconBluetooth`, `apps/mobile/android/.../bluetooth`            | CoreBluetooth / BluetoothGatt, GATT queue, event emission, error mapping               | Trust JS for connection state            |

Dependency direction is strictly downward in the table. `packages/*` never import from
`apps/mobile`.

## Data flow (M0–M5)

```text
NavigationContainer ─ DeviceListScreen ──► DeviceDetailScreen ──► GattInspectorScreen ──► CharacteristicDetailScreen
   ▲ reads                                 ▲ reads by id, polls RSSI      ▲ reads the cached table by id   ▲ reads, writes, lists packets
ScanProvider: readiness + scan + device cache   ConnectionProvider: per-device machine   GattProvider: per-device table   PacketLogProvider: per-device ring buffer
   ▲                                              ▲                    ▲                     ▲                    ▲ useCharacteristicOperations
   │ BluetoothAdapterApi / PermissionApi          │ ScanApi            │ ConnectionApi       │ GattDiscoveryApi   │ GattValueApi (read / write)
   │                                              │ scan.device_discovered / ble.error (no deviceId)
   │                                              │                    │ connection.state_changed / ble.error (deviceId)
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
`ConnectionApi`, and `useCharacteristicOperations` the only caller of `GattValueApi`; screens
express intent (`start`, `stop`, `connect`, `disconnect`, `read`, `write`) and read derived
state. The coordinators live above the navigator (ADR 0005), so scanning, links and the packet
history survive screen changes.

Provider order in `App.tsx`, outermost first: `BleClientProvider` → `ScanProvider` →
`ConnectionProvider` → `GattProvider` → `PacketLogProvider` → navigation. Each provider may
read the ones above it (the GATT provider watches the connection machine to drop a table with
its link; the packet log is written by the characteristic operations hook underneath it) and
never the ones below.

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
parsers live in `@beacon/ble-contracts` (`bytes.ts`) so the M7 parsers and the M8 recorder
work on the same `number[]` representation that crosses the bridge (ADR 0006).

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
`writeCharacteristic`) and `GattNotifyApi` (M6). `BleClient` (the app's type) is the
intersection of the segments implemented so far: adapter, permission, scan, connection, GATT
discovery and GATT values after M5.

## State management

State is separated by responsibility (PROJECT.md 5). M0 introduced the adapter reducer, M1 the
permission reducer and readiness projection, M2 the scan reducer, device cache and in-memory
filters, M3 the per-device connection reducer, M4 the per-device GATT table tied to the link,
M5 the per-characteristic operation reducer and the per-device packet log; sessions, UI state
and persisted preferences each get their own module as their milestones land. There is no
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

## Monorepo mechanics

- yarn 1 workspaces hoist dependencies to the repo root.
- Metro watches the repo root and resolves from both `apps/mobile/node_modules` and the root.
- Gradle resolves `react-native`, `@react-native/codegen`, `hermes-compiler` (the prebuilt
  Hermes compiler used for release bundles) and the RN Gradle plugin through Node
  (`require.resolve`) instead of hard-coded `../node_modules` paths.
- The Podfile already resolves `react_native_pods.rb` through Node.
- One root `tsconfig.json`, `eslint.config.js`, `babel.config.js`, and a Jest `projects` config
  cover every workspace.
