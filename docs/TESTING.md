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
  polling, stale hiding) run under Jest fake timers.
- Native tests cover the parts that can run without hardware: state and error mapping and the
  wire value contract. Anything touching a real radio is validated manually and reported as such.
- Contract parity: the Swift and Kotlin tests assert that their wire values equal the TypeScript
  unions verbatim, so a renamed code fails on every platform.

## Mock BLE layer

`apps/mobile/src/mock/createMockBleClient.ts` implements the M2 client surface with scripted
peripherals that advertise on their own intervals with drifting RSSI, refuses to scan when the
simulated radio is off or permission is missing, and exposes hooks to script failures
(`failNextScanStart`, `failRunningScan`, `setAdapterState`). It takes an injectable scheduler,
clock and random source, so its own tests are deterministic. It is a runtime option
(`USE_MOCK_BLE_CLIENT` in `apps/mobile/src/app/runtimeOptions.ts`) so reviewers can run Beacon
without hardware; M10 extends it with connections, GATT and disconnect scenarios.

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
