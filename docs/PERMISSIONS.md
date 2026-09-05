# Permissions

Permission handling is centralized (PROJECT.md 12). M0 declares what the platforms require;
the runtime request flow and `BlePermissionState` mapping ship with M1.

## Contract

```ts
type BlePermissionState = 'unknown' | 'not_requested' | 'granted' | 'denied' | 'blocked';
```

`blocked` means the user must change the setting in the OS Settings app; re-requesting from the
app will not show a prompt.

## iOS

- `NSBluetoothAlwaysUsageDescription` is declared in `Info.plist`. Without it CoreBluetooth
  terminates the app when the central manager is created.
- The system prompt appears the first time a `CBCentralManager` is created. `BluetoothManager`
  defers creation until JavaScript first asks for adapter state, so the prompt is tied to a user
  visible action rather than app launch.
- Authorization is read from `CBManager.authorization` (M1). A denied authorization surfaces as
  `BluetoothState.unauthorized` from the adapter as well.
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

Reading `BluetoothAdapter.getState()` and observing `ACTION_STATE_CHANGED` need no runtime
permission on any supported API level, so M0 never triggers a permission dialog on Android.

M1 will request only the permissions the running API level needs (PROJECT.md 12): scan and
connect on 31+, fine location on 30 and below, and map `shouldShowRequestPermissionRationale`
outcomes to `denied` versus `blocked`.
