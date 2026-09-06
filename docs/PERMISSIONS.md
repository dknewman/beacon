# Permissions

Permission handling is centralized (PROJECT.md 12). M0 declared what the platforms require;
M1 added the runtime flow: a `PermissionApi` on the bridge, a permission state machine in the
UI layer, and settings guidance derived from adapter state and permission together.

## Contract

```ts
type BlePermissionState = 'unknown' | 'not_requested' | 'granted' | 'denied' | 'blocked';

interface PermissionApi {
  getPermissionState(): Promise<BlePermissionState>; // never prompts
  requestPermission(): Promise<BlePermissionState>; // prompts when possible, resolves with the result
}
```

| State           | Meaning                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `not_requested` | The app has never asked; `requestPermission()` will show the prompt.    |
| `granted`       | Scanning and connecting are allowed.                                    |
| `denied`        | Declined, but the platform will prompt again (Android only).            |
| `blocked`       | The user must change the setting in the OS Settings app; no prompt.     |
| `unknown`       | The platform returned a value outside the known set (future OS values). |

The bridge validates every value with `blePermissionStateSchema`; anything else rejects with
`invalid_payload`.

## iOS

- `NSBluetoothAlwaysUsageDescription` is declared in `Info.plist`. Without it CoreBluetooth
  terminates the app when the central manager is created.
- Authorization is read from `CBManager.authorization` and mapped by
  `AuthorizationMapper.swift`: `.notDetermined` → `not_requested`, `.allowedAlways` →
  `granted`, `.denied` and `.restricted` → `blocked`. iOS never re-prompts, so `denied` is
  never produced on iOS.
- The prompt is a side effect of creating the first `CBCentralManager`. `BluetoothManager`
  therefore:
  - does **not** create the central while authorization is undetermined, and reports the
    adapter state as `unknown` until then (so app launch never prompts);
  - creates it inside `requestPermission()` and completes the request from
    `centralManagerDidUpdateState`, which CoreBluetooth calls after the user answers;
  - reports `unauthorized` as the adapter state when authorization was refused, without
    touching CoreBluetooth.
- After a refusal the only remedy is the Settings app; the UI opens the app's settings page
  via `Linking.openSettings()`.
- No background modes are declared. Background scanning is a stretch goal and would require
  `bluetooth-central` in `UIBackgroundModes` plus explicit product intent.

## Android

Declared in `AndroidManifest.xml`:

| Permission                            | API levels | Why                                                       |
| ------------------------------------- | ---------- | --------------------------------------------------------- |
| `BLUETOOTH`, `BLUETOOTH_ADMIN`        | ≤ 30       | Legacy install-time Bluetooth permissions                 |
| `ACCESS_FINE_LOCATION`                | ≤ 30       | Required by the OS for BLE scan results on older versions |
| `BLUETOOTH_SCAN` (`neverForLocation`) | ≥ 31       | Scanning; Beacon never derives location from scans        |
| `BLUETOOTH_CONNECT`                   | ≥ 31       | Connecting and reading device names                       |

`<uses-feature android.hardware.bluetooth_le required="false">` keeps the app installable on
devices without BLE; the adapter reports `unsupported` instead.

Runtime flow (`permissions/PermissionController.kt`):

- `RequiredPermissions.forApiLevel` returns `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` on API 31+
  and `ACCESS_FINE_LOCATION` on API 30 and below. Nothing else is ever requested.
- `PermissionStateMapper.resolve` turns three facts into the contract state: whether every
  permission is granted, whether `shouldShowRequestPermissionRationale` is true for a missing
  one, and whether the app has requested before. The last fact is persisted in
  `SharedPreferences`, because Android reports rationale = false both before the first request
  and after "don't ask again".
- `requestPermission()` needs the foreground `PermissionAwareActivity` (React Native routes
  `onRequestPermissionsResult` through it); without one it rejects with `native_failure`.
  One request may be in flight at a time. The request is always attempted when something is
  missing: if the user chose "don't ask again", the platform answers immediately and the
  resulting state is still accurate.
- Reading `BluetoothAdapter.getState()` and observing `ACTION_STATE_CHANGED` need no runtime
  permission, so adapter state is available before any prompt.

## UI behaviour

`useBluetoothPermission` reads the state on mount and again whenever the app returns to the
foreground (`AppState`), so a change made in Settings is picked up without a restart.
Foreground re-checks are ignored while a prompt is in flight.

`deriveBluetoothReadiness` combines adapter and permission state into one instruction for the
user, in this precedence: failure, unsupported hardware, prompt in flight, checking, permission,
adapter power state. Each readiness state maps to at most one action:

| Readiness              | Action                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `permission_required`  | Ask (`requestPermission`)                                    |
| `permission_blocked`   | Open app settings                                            |
| `powered_off`          | Android: Bluetooth settings intent; iOS: app settings + text |
| `failed`               | Retry both reads                                             |
| `unsupported`, `ready` | None                                                         |
