# Testing

## Layers and tools

| Layer                                        | Tool                                   | Location                               |
| -------------------------------------------- | -------------------------------------- | -------------------------------------- |
| Shared TypeScript packages                   | Jest (node environment)                | `packages/*/src/__tests__`             |
| App logic (reducers, labels, bridge wrapper) | Jest + `@react-native/jest-preset`     | `apps/mobile/src/**/__tests__`         |
| Component / integration                      | React Native Testing Library 14        | `apps/mobile/tests`                    |
| Swift                                        | XCTest (`BeaconBluetoothTests` target) | `apps/mobile/ios/BeaconBluetoothTests` |
| Kotlin                                       | JUnit 4 (`testDebugUnitTest`)          | `apps/mobile/android/app/src/test`     |
| End to end                                   | Maestro or Detox (planned, M11+)       |                                        |

Run everything JavaScript from the repo root: `yarn validate` (typecheck, lint, format check,
tests).

## Principles

- Tests accompany meaningful logic (PROJECT.md 41). Pure mapping and state code is tested on
  every platform where it exists: UUID normalization, error mapping, adapter state mapping,
  reducers, validation schemas.
- Integration tests mock native events, not modules. `FakeBluetoothAdapterClient` implements the
  same `BluetoothAdapterApi` contract as the real bridge wrapper and is injected through the
  composition root; no `jest.mock` of the Turbo Module is needed.
- The bridge wrapper is tested against a hand written fake of the codegen spec, so malformed
  native payloads are exercised without a device.
- Native tests cover the parts that can run without hardware: state and error mapping and the
  wire value contract. Anything touching a real radio is validated manually and reported as such.
- Contract parity: the Swift and Kotlin tests assert that their wire values equal the TypeScript
  unions verbatim, so a renamed code fails on every platform.

## Mock BLE layer (M10)

`MockBleClient` will implement the full `NativeBleClient` with scripted heart rate, battery and
weight scale peripherals plus failure scenarios (connection failure, powered off, disconnect). It
is a first class runtime option so reviewers can run Beacon without hardware.

## What CI runs

See `.github/workflows/ci.yml`:

1. `js`: install, typecheck, lint, format check, Jest with coverage.
2. `android`: install, Gradle `testDebugUnitTest` and `assembleDebug` (runs codegen and compiles
   the Kotlin module).
3. `ios`: install, `pod install`, `xcodebuild build` and `xcodebuild test` on a simulator.
