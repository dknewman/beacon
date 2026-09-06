# Native Bridge

Beacon uses a React Native **Turbo Native Module** generated from a TypeScript spec. The bridge
is deliberately narrow: primitives, plain objects, promises and typed event emitters only. All
domain typing and validation happen on the JavaScript side.

## Spec

`apps/mobile/src/native/specs/NativeBeaconBluetooth.ts`

```ts
export interface Spec extends TurboModule {
  getBluetoothState(): Promise<string>;
  readonly onBluetoothStateChanged: CodegenTypes.EventEmitter<{ state: string }>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('BeaconBluetooth');
```

Codegen configuration lives in `apps/mobile/package.json` (`codegenConfig`). The iOS module is
registered through `ios.modulesProvider`; the Android module is registered manually in
`MainApplication.kt` via `BeaconBluetoothPackage`.

Generated artifacts (never committed):

- iOS: `ios/build/generated/ios/ReactCodegen/BeaconBluetoothSpec/BeaconBluetoothSpec.h` defines
  `NativeBeaconBluetoothSpec` (protocol), `NativeBeaconBluetoothSpecBase` (event emitter base
  class) and `NativeBeaconBluetoothSpecJSI`.
- Android: `com.beacon.bluetooth.spec.NativeBeaconBluetoothSpec` (abstract class with
  `getBluetoothState(Promise)` and `emitOnBluetoothStateChanged(ReadableMap)`). The package
  comes from `codegenConfig.android.javaPackageName`, which the Gradle plugin honors.

The iOS and Android builds run codegen automatically. The standalone
`react-native codegen` command also works for inspection, but note that it ignores
`javaPackageName` for app projects and emits the Android spec under `com.facebook.fbreact.specs`;
the Gradle build is the source of truth.

## iOS

```text
BeaconBluetoothModule.mm  (Objective-C++)  — conforms to the generated spec, forwards to Swift
BluetoothManager.swift                     — owns CBCentralManager, emits state via closure
Mapping/BluetoothStateMapper.swift         — CBManagerState → wire value
Errors/BleError.swift                      — CoreBluetooth errors → contract codes
```

The Objective-C++ file is required because the generated spec is C++-aware; it is intentionally
free of Bluetooth logic. Swift is exposed through the Xcode-generated `Beacon-Swift.h` using
`@objc(BeaconBluetoothManager)`.

Threading: CoreBluetooth callbacks arrive on a private serial queue. The codegen event emitter is
thread safe, so events are emitted from that queue directly.

## Android

```text
BeaconBluetoothModule.kt   — extends generated NativeBeaconBluetoothSpec, module lifecycle
BeaconBluetoothPackage.kt  — BaseReactPackage registration (isTurboModule = true)
BluetoothController.kt     — BluetoothManager/BluetoothAdapter, ACTION_STATE_CHANGED receiver
mapping/BluetoothStateMapper.kt
errors/BleError.kt         — contract codes, Promise.rejectWith, Throwable.toBleError
```

`initialize()` starts the broadcast receiver and `invalidate()` stops it, so no receiver leaks
across React instance reloads. Events are emitted only once the TurboModule infrastructure has
bound the emitter callback.

## JavaScript wrapper

`apps/mobile/src/native/createNativeBluetoothAdapterClient.ts` implements
`BluetoothAdapterApi`:

- `getBluetoothState()` validates the string with `parseBluetoothState`; invalid values reject
  with `BleError("invalid_payload")`; native rejections are mapped with `toBleError` and default
  to `native_failure`.
- `subscribe()` folds each typed emitter into the `NativeBleEvent` union, validates, and returns
  an unsubscribe function that removes the native subscription.

## Error convention

Native rejects promises with `code` set to a `BleErrorCode` wire value and the message as a
human readable string. Android additionally passes `nativeCode`/`nativeDomain` through the
rejection `userInfo`. JavaScript reads `code` in `toBleError`.

## Extending the bridge

1. Add the method or emitter to the spec using codegen-compatible types.
2. Add the matching segment implementation to the contract wrapper and validate its payloads.
3. Implement in Swift (`BluetoothManager` or a new `PeripheralSession`) and expose through the
   `.mm` shim.
4. Implement in Kotlin (`BluetoothController` / `DeviceConnection`) and override in the module.
5. Add JS tests with a fake spec, plus XCTest and JUnit tests for pure mapping logic.
