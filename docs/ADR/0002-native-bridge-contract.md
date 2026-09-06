# ADR 0002: Codegen Turbo Module bridge with runtime validation

Status: Accepted (M0)

## Context

React Native's New Architecture is the default since 0.76. Native modules can be written as
legacy bridge modules (still supported through an interop layer) or as Turbo Modules generated
from a TypeScript spec. The project requires a narrow, typed, validated boundary.

## Decision

1. One Turbo Module, `BeaconBluetooth`, defined by a codegen spec that uses only primitives,
   plain objects, promises and `CodegenTypes.EventEmitter`.
2. One typed emitter per event kind (`onBluetoothStateChanged`, later `onDeviceDiscovered`,
   `onConnectionStateChanged`, `onCharacteristicValueChanged`, `onError`) rather than one untyped
   envelope. The JavaScript wrapper folds them into the `NativeBleEvent` discriminated union.
3. Every value crossing the boundary is validated with zod in `@beacon/validation`. Invalid
   payloads become `BleError("invalid_payload")` (promises) or `ble.error` events (streams).
4. Errors use a shared string vocabulary (`BleErrorCode`) that Swift and Kotlin enums mirror and
   test for parity.
5. iOS implements the spec in a thin Objective-C++ class that forwards to Swift, because the
   generated spec is C++-aware. Android extends the generated abstract Kotlin/Java class.
6. The wrapper implements contract segments (`BluetoothAdapterApi`, `ScanApi`, ...) so each
   milestone ships a complete segment instead of stubbing methods.

## Alternatives considered

- Legacy `RCTEventEmitter`/`@ReactMethod` modules: simpler, but deprecated direction and untyped.
- A single JSON string event channel: trivially codegen-compatible, but throws away static typing
  and adds serialization cost on high frequency notifications.
- A C++ shared Turbo Module: strong typing across platforms, but pushes BLE logic out of Swift
  and Kotlin, contrary to the portfolio goals.

## Consequences

- The Android spec is generated into `codegenConfig.android.javaPackageName`
  (`com.beacon.bluetooth.spec`) by the Gradle plugin. The standalone codegen script ignores that
  setting for apps, so Kotlin must be validated against the Gradle build, not the script.
- Adding a bridge method touches the spec, the wrapper, Swift, ObjC++ and Kotlin. That is
  accepted; the cost is the same on every milestone and keeps the boundary reviewable.
- Codegen runs during native builds; generated files are not committed.
