# BLE State Model

All Bluetooth state is modelled as explicit unions in `packages/ble-contracts`. Booleans are
never the source of truth (PROJECT.md 3.3, 14).

## Adapter state (`BluetoothState`)

```text
unknown | unsupported | unauthorized | powered_off | powered_on | resetting
```

| Value          | iOS (`CBManagerState`)                      | Android                                              |
| -------------- | ------------------------------------------- | ---------------------------------------------------- |
| `unknown`      | `.unknown` (before first delegate callback) | `BluetoothAdapter.ERROR` or unrecognized state       |
| `unsupported`  | `.unsupported`                              | No `FEATURE_BLUETOOTH_LE`, or no adapter             |
| `unauthorized` | `.unauthorized`                             | Never produced; see PERMISSIONS.md                   |
| `powered_off`  | `.poweredOff`                               | `STATE_OFF`, `STATE_TURNING_ON`, `STATE_TURNING_OFF` |
| `powered_on`   | `.poweredOn`                                | `STATE_ON`                                           |
| `resetting`    | `.resetting`                                | Never produced                                       |

Only `powered_on` is usable (`isBluetoothUsable`).

## UI adapter status (`BluetoothAdapterStatus`)

The UI layer wraps the adapter state with the bridge lifecycle:

```text
initializing ──native_state_received──► ready(state)
     │                                     │
     └──native_failed──► failed(error) ◄───┘ native_failed
                             │
                             └──retry_requested──► initializing
```

`retry_requested` is ignored outside `failed`. Subsequent `native_state_received` actions replace
the state in place. Implemented in `bluetoothAdapterReducer.ts` with exhaustive switches.

## Permission status (`PermissionStatus`) — M1

```text
checking ──state_received──► ready(state) ──request_started──► requesting
   │                             ▲                                 │
   │                             └──────────state_received─────────┘
   └──request_failed──► failed(error) ──retry_requested──► checking
```

`request_started` is idempotent while already requesting. Foreground re-checks never dispatch
while a request is in flight, so a prompt has exactly one answer. Implemented in
`permissionReducer.ts`.

## Readiness (`BluetoothReadiness`) — M1

A pure projection of the two machines above, used by the UI and, from M2, by the scan
coordinator to decide whether scanning may start:

```text
checking | failed(error) | unsupported | permission_required(state) | permission_requesting
| permission_blocked | powered_off | unavailable(unknown|resetting) | ready
```

Precedence is failure, unsupported, requesting, checking, permission, then adapter power.
Implemented in `bluetoothReadiness.ts`; guidance text and the single next action per state
live in `readinessPresentation.ts`.

## Scan state (`ScanStatus`) — M2

```text
idle|failed ──start_requested──► starting ──start_succeeded──► scanning
starting|scanning ──stop_requested──► stopping ──stop_succeeded──► idle
starting ──start_failed──► failed
stopping ──stop_failed──► failed
starting|scanning|stopping ──native_failed──► failed
```

`phase` uses the shared `ScanState` vocabulary (`idle | starting | scanning | stopping | failed`).
Every other (phase, action) pair is a no-op, which is what makes the coordinator safe against
late promise results: a stop requested while the start call is in flight moves to `stopping`,
the late `start_succeeded` is ignored, and the coordinator waits for the start promise before
calling `stopScan`. Implemented in `features/scan/scanReducer.ts`; driven by
`useScanCoordinator`, which also owns the device cache (ADR 0004).

Gate: the coordinator starts a scan only while readiness is `ready` and stops it when readiness
leaves that state (radio off, permission revoked). Discovery events are accepted only in
`starting` or `scanning`.

### Error routing

`ble.error` events without a `deviceId` are adapter or bridge failures and move the adapter
machine to `failed`, with one exception: code `scan_failed` belongs to the scan machine
(`native_failed`). Device-scoped errors (`deviceId` present) belong to the connection coordinator: they move that
device to `failed`, and native always sends them before the `disconnected` they cause.

## Connection state (`DeviceConnection`) — M3

```text
disconnected|failed ──connect_requested──► connecting
connecting ──native connected──► connected ──native discovering_services──► discovering_services ──native ready──► ready
connecting|connected|discovering_services|ready ──disconnect_requested──► disconnecting ──native disconnected──► disconnected
any ──native error (deviceId) / request_failed / timeout──► failed ──native disconnected──► disconnected (lastError kept)
```

Native is authoritative: every `connection.state_changed` event is applied as-is
(`features/connection/connectionReducer.ts`). JavaScript adds only the optimistic `connecting`
when the user taps Connect, the `failed` state from a rejected call or the 15 s timeout, and
`lastError`, which survives `failed → disconnected` so the detail screen can say why the link
ended. A clean, user-initiated disconnect leaves no `lastError`.

The coordinator (`ConnectionProvider`) lives above navigation, allows one attempt per device,
cancels a timed-out attempt through `disconnect`, and ignores the rejection of an attempt it
ended itself. Adapter loss ends every link natively (error `bluetooth_powered_off`, then
`disconnected`).

Wire vocabulary (`ConnectionState`): `disconnected | connecting | connected |
discovering_services | ready | disconnecting | failed`; mirrored by `BleConnectionState` in
Swift and Kotlin with parity tests.

## Events

`NativeBleEvent` is a discriminated union on `type`:

```text
bluetooth.state_changed { state }
scan.device_discovered  { device }
connection.state_changed { deviceId, state }
characteristic.value_changed { deviceId, serviceUuid, characteristicUuid, bytes, timestamp }
ble.error { deviceId?, error }
```

Every event is validated by `nativeBleEventSchema` before application code sees it. A malformed
payload is converted into a `ble.error` with code `invalid_payload` so bridge bugs are visible
rather than silently dropped.
