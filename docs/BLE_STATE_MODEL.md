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

## Scan state (`ScanState`) — M2

```text
idle | starting | scanning | stopping | failed
```

## Connection state (`ConnectionState`) — M3

```text
disconnected → connecting → connected → discovering_services → ready
any → failed → disconnected
ready/connected → disconnecting → disconnected
```

Native code drives transitions and emits `connection.state_changed`; JavaScript mirrors them
after validation. The transition table and its tests arrive with the connection coordinator.

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
