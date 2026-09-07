# Testing

## Layers and tools

| Layer                                        | Tool                                                         | Location                               |
| -------------------------------------------- | ------------------------------------------------------------ | -------------------------------------- |
| Shared TypeScript packages                   | Jest (node environment)                                      | `packages/*/src/__tests__`             |
| App logic (reducers, labels, bridge wrapper) | Jest + `@react-native/jest-preset`                           | `apps/mobile/src/**/__tests__`         |
| Component / integration                      | React Native Testing Library 14, real React Navigation stack | `apps/mobile/tests`                    |
| Swift                                        | XCTest (`BeaconBluetoothTests` target)                       | `apps/mobile/ios/BeaconBluetoothTests` |
| Kotlin                                       | JUnit 4 (`testDebugUnitTest`)                                | `apps/mobile/android/app/src/test`     |
| End to end                                   | Maestro or Detox (planned, M11+)                             |                                        |

Run everything JavaScript from the repo root: `yarn validate` (typecheck, lint, format check,
tests).

## Principles

- Tests accompany meaningful logic (PROJECT.md 41). Pure mapping and state code is tested on
  every platform where it exists: UUID normalization, error mapping, adapter state mapping,
  reducers, validation schemas.
- Integration tests mock native events, not modules. `FakeBleClient` implements the same
  `BleClient` contract as the real bridge wrapper and is injected through the composition root;
  no `jest.mock` of the Turbo Module is needed. Every native call stays pending until the test
  settles it, so in-flight states (starting, stopping, asking) and races (stop during start)
  are asserted, not assumed.
- The bridge wrapper is tested against a hand written fake of the codegen spec, so malformed
  native payloads are exercised without a device.
- Integration tests drive the real navigator: they tap a row, assert on the detail screen, and
  go back. `@react-navigation/*` and `react-native-screens` are ESM-only and are added to the
  Jest transform allow-list in `apps/mobile/jest.config.js`. Timers (connect timeout, RSSI
  polling, stale hiding, the notification flush) run under Jest fake timers, so the 100 ms
  batching is asserted by advancing the clock rather than by waiting.
- Native tests cover the parts that can run without hardware: state and error mapping and the
  wire value contract. Anything touching a real radio is validated manually and reported as such.
- Contract parity: the Swift and Kotlin tests assert that their wire values equal the TypeScript
  unions verbatim, so a renamed code fails on every platform (adapter state, permission state,
  error codes, connection state, characteristic properties).
- Native logic that can be pure is written pure and tested: the `GattOperationQueue` has no
  CoreBluetooth or Android dependency, so its ordering, failed-start and cancellation behavior
  is asserted in XCTest and JUnit; only the owners that call the platform are left to hardware.

## Read and write coverage (M5)

| Suite                                                                                  | Covers                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ble-contracts/src/__tests__/bytes.test.ts`                                   | Every column for the PROJECT.md packet example; strict UTF-8 decode (truncated, overlong, surrogate, out-of-range input) and encode round trip; hex, decimal and UTF-8 input parsing with the user-facing messages                                 |
| `apps/mobile/src/features/packets/__tests__/packetLogReducer.test.ts`                  | Newest-first order per device, the capacity cap dropping the oldest, `packetsForCharacteristic` and `log_cleared`, unique `createPacket` ids with ISO timestamps                                                                                   |
| `apps/mobile/src/features/packets/__tests__/packetPresentation.test.ts`                | Local clock time with milliseconds; row labels (direction, hex, byte count, accessibility label)                                                                                                                                                   |
| `apps/mobile/src/features/gatt/__tests__/characteristicOperations.test.ts`             | `idle → reading/writing → idle`, ignored starts while busy, `lastOutcome` per completion, status text with the error code                                                                                                                          |
| `apps/mobile/src/native/__tests__/createNativeBleClient.test.ts` ("connections")       | Read results validated as bytes (`invalid_payload` for anything outside `0..255`), `mode` mapped onto the `withResponse` flag, `read_failed` / `write_failed` defaults                                                                             |
| `apps/mobile/tests/App.test.tsx` ("characteristic read and write")                     | Reading and showing every column, logging the packet, failed reads and writes with their codes, per-mode input validation, both write modes, controls disabled when the link drops with the history kept, and a read in flight when the link drops |
| `apps/mobile/src/mock/__tests__/createMockBleClient.test.ts` ("reads scripted values") | Scripted values, stored writes, property enforcement, `service_not_found` / `characteristic_not_found`, scripted `failNextRead` and recovery                                                                                                       |
| `apps/mobile/ios/BeaconBluetoothTests/GattOperationQueueTests.swift`                   | One operation at a time in order, a failed start does not block the next, `cancelAll` returns in-flight and pending, `finish` while idle is harmless                                                                                               |
| `apps/mobile/android/app/src/test/.../connection/GattOperationQueueTest.kt`            | The same four cases on the JVM                                                                                                                                                                                                                     |
| `apps/mobile/ios/BeaconBluetoothTests/ByteArrayMapperTests.swift`                      | Whole numbers in `0...255` accepted, double-backed `NSNumber` as React Native delivers them, out-of-range / fractional / non-finite values rejected, `Data` ⇄ `[NSNumber]` round trip                                                              |
| `apps/mobile/android/app/src/test/.../mapping/ByteArrayMapperTest.kt`                  | Packing unsigned values into bytes, an empty payload as a valid empty write, out-of-range / fractional / undefined values rejected, unpacking as unsigned integers, round trip                                                                     |
| `apps/mobile/ios/BeaconBluetoothTests/GattMapperTests.swift` (`canonicalUuid`)         | Agrees with `normalizeUuid` in TypeScript and with CoreBluetooth's own rendering; rejects anything that is not a UUID                                                                                                                              |

## Notification coverage (M6)

| Suite                                                                                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/features/subscriptions/__tests__/subscriptionReducer.test.ts`                 | `off → subscribing → on → unsubscribing → off`, acknowledgements ignored unless they match the phase, a failed subscribe returning to `off` with the reason and a failed unsubscribe staying `on`, batched counts accumulated per characteristic with the newest time kept, `link_ended` dropping every subscription of that device and no other, the status text for every phase                                                           |
| `apps/mobile/src/features/packets/__tests__/packetLogReducer.test.ts` (`packets_recorded`)     | A batch recorded as one update, newest first, still capped                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/mobile/src/native/__tests__/createNativeBleClient.test.ts` ("connections", "events")     | `setNotify` flattened onto the four scalar arguments with `subscription_failed` as the default code; `characteristic.value_changed` normalized (UUIDs, byte range, timestamp) and a malformed one surfaced as `invalid_payload`; every native subscription removed on unsubscribe                                                                                                                                                           |
| `apps/mobile/tests/App.test.tsx` ("notifications")                                             | Subscribe, "Subscribing…" while the call is pending and `On` only after it resolves, a burst of three values landing as one flush (count, packet list, value columns, "Received at"), unsubscribe with the history kept; 25 values in one flush window rendering once at 100 ms and not at 99; a refused subscription reported with its code and retried; the link dropping while subscribed (control gone, reconnecting starts from `Off`) |
| `apps/mobile/src/mock/__tests__/createMockBleClient.test.ts` ("pushes scripted notifications") | Scripted notifiers starting on subscribe, stopping on unsubscribe and with the link, property enforcement ("Notifications not supported"), scripted `failNextSetNotify`                                                                                                                                                                                                                                                                     |
| `apps/mobile/ios/BeaconBluetoothTests/CharacteristicValueMapperTests.swift`                    | Every field mapped with canonical UUIDs, vendor UUIDs kept in their full form, a missing value sent as an empty packet, the payload matching the bridge shape, the subscription key built from the same canonical UUIDs as the event                                                                                                                                                                                                        |
| `apps/mobile/android/app/src/test/.../mapping/NotificationDescriptorMapperTest.kt`             | `ENABLE_NOTIFICATION_VALUE` when the characteristic notifies and when it offers both, `ENABLE_INDICATION_VALUE` only when indications are all it offers, `DISABLE_NOTIFICATION_VALUE` whatever it offers, no value for a characteristic with neither, `CCCD_UUID` is the assigned number `0x2902`                                                                                                                                           |
| `apps/mobile/android/app/src/test/.../mapping/GattStatusMapperTest.kt` (`requestRejection`)    | A refused subscription change keeping its own code and the peripheral's status; the API 33 request status codes telling acceptance, missing permission and rejection apart                                                                                                                                                                                                                                                                  |
| `apps/mobile/android/app/src/test/.../mapping/BleUuidTest.kt` (`format`)                       | Platform UUIDs formatted in the uppercase hyphenated wire form the table and the value events share                                                                                                                                                                                                                                                                                                                                         |

## Mock BLE layer

`apps/mobile/src/mock/createMockBleClient.ts` implements the whole client surface with
scripted peripherals that advertise on their own intervals with drifting RSSI, connect through
every transition, serve a scripted GATT table and characteristic values (`values` in
`mockPeripherals.ts`), store writes so the next read returns them, push notifications and
indications on scripted intervals once subscribed (`notifiers` in `mockPeripherals.ts`, a
`MockNotifier` per characteristic with `intervalMs` and a `produce(sequence, random)` value
builder: a drifting heart rate every second, a battery level every 5 s, a weight measurement
indication every 2 s, Nordic UART TX every 300 ms) and stop them with the link, enforce the
characteristic properties the way native does ("Read not permitted" / "Write not permitted" /
"Notifications not supported"), and refuse to scan or connect when the simulated radio is off
or permission is missing. Hooks script failures (`failNextScanStart`, `failRunningScan`,
`setAdapterState`, `failNextConnect`, `stallNextConnect`, `dropConnection`, `failNextRead`,
`failNextWrite`, `failNextSetNotify`), `valueOf` reads back what a write stored and
`isNotifying` tells whether a notifier is running. It takes an injectable scheduler, clock and
random source, so its own tests are deterministic. It is a
runtime option (`USE_MOCK_BLE_CLIENT` in `apps/mobile/src/app/runtimeOptions.ts`) so reviewers
can run Beacon without hardware; M10 completes it with the remaining failure scenarios.

## Hardware validation

Anything touching a real radio is validated by a person and recorded in the README milestone
table with the device and what was observed. Nothing in this repository claims hardware
validation that has not been performed.

## What CI runs

`.github/workflows/ci.yml` runs on every pull request, on pushes to `main`, and on manual
dispatch. Runs for the same ref cancel each other so only the latest push is built.

1. `js` (ubuntu): install, typecheck, lint, format check, Jest with coverage artifact.
2. `android` (ubuntu, after `js`): Android SDK 37 / NDK 27 / CMake, Gradle
   `:app:testDebugUnitTest` then `:app:assembleRelease` for arm64 (runs codegen, compiles the
   Kotlin module, bundles the JavaScript, uploads a standalone APK as an artifact that runs on
   a phone without Metro). Kotlin sources are also compiled against the generated spec and the
   JUnit suite run on a plain JVM during development, so most compile errors never reach CI.
3. `ios` (macOS, after `js`): Ruby 3.3 with the committed `Gemfile.lock`, `pod install` with a
   CocoaPods cache, then `xcodebuild test` on the first available iPhone simulator with code
   signing disabled. The `.xcresult` bundle is uploaded when the job fails.

Branch protection on `main` requires the `js` and `android` checks; the `ios` check is added to
the required set once it has a green history. Dependabot (`.github/dependabot.yml`) opens weekly
grouped updates for npm, Gradle, Bundler and GitHub Actions; React Native itself is excluded
because upgrades are done by hand with the upgrade helper.
