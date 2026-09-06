# ADR 0005: React Navigation native stack; connect() resolves at `ready`; JavaScript owns the timeout

Status: Accepted (M3)

## Context

M3 introduces the second screen (Device Detail) and the first long-lived native resource
(a GATT connection). Three decisions had to be made together:

1. how screens are navigated (PROJECT.md 5 asks for a mature library);
2. what the bridge promise for `connect(deviceId)` means, given that every transition is also
   an event;
3. who enforces a connection timeout, since CoreBluetooth never times out a pending
   connection and Android's own timeout (about 30 s, status 133) is opaque.

## Decision

### Navigation

`@react-navigation/native` with `@react-navigation/native-stack` (backed by
`react-native-screens`). Routes carry identifiers only (`DeviceDetail: { deviceId }`); screens
read live data from the coordinators by id, so a route never holds a stale device object.

The coordinators (`ScanProvider`, `ConnectionProvider`) sit **above** the navigator. Scanning,
the device cache and every connection therefore survive navigation, and the detail screen shows
the same cache row the list shows.

### `connect()` promise

`connect(deviceId)` resolves once the session is `ready` (link established and services
discovered) and rejects with the contract code that ended the attempt: `device_not_found`,
`connection_failed`, `connection_timeout` (Android status 8 / 62), `disconnected` (cancelled),
`bluetooth_powered_off`, `permission_denied`, `service_not_found`. Every intermediate transition
is still emitted on `connection.state_changed`, so the UI shows `connecting`, `connected`,
`discovering_services` and `ready` as they happen; the promise exists for callers that need a
single completion, such as the timeout below and the M4 GATT calls.

Errors are emitted **before** the `disconnected` transition they cause, on both platforms, and
always with `deviceId`. The reducer relies on this ordering to attach the reason to the final
`disconnected` state (`lastError`).

`disconnect(deviceId)` resolves once the platform has confirmed the link is gone and doubles
as cancellation of a pending attempt. Because neither platform promises a callback for a
cancelled pending connection, native settles the cancellation itself and treats a late
callback as a no-op.

### Timeout

The connection coordinator (`ConnectionProvider`) owns a 15 s timeout per attempt. On expiry it
marks the device `failed` with `connection_timeout` and calls `disconnect` so native stops
trying. A rejection that arrives for an attempt JavaScript already ended (cancel or timeout) is
ignored, so the recorded reason is the one the user saw.

## Alternatives considered

- `connect()` resolving when the request is accepted (fire and forget): simpler natively, but
  every caller would then have to reconstruct completion from events, and M4's `discoverServices`
  would need its own "wait for ready" logic.
- A native timeout: two implementations to keep aligned, and the JavaScript side still needs a
  timer to keep the UI honest if native never answers. One timer in one place is easier to test.
- Keeping coordinators inside screens: the connection would drop when the detail screen was
  popped, which contradicts PROJECT.md 13 (the list should show connected devices).
- A stack built on `react-native-gesture-handler` / JS-driven stacks: more dependencies and
  no native back-swipe on iOS.

## Consequences

- Jest must transform `@react-navigation/*` and `react-native-screens` (ESM-only packages);
  `apps/mobile/jest.config.js` extends the preset's `transformIgnorePatterns`.
- `react-native-screens` adds a native dependency on both platforms (autolinked; CI builds it).
- The detail screen polls RSSI every 3 s only while it is focused and the link is `ready`
  (PROJECT.md 22: avoid excessive polling).
- Peripheral objects discovered by the scanner are retained natively on iOS so they can be
  connected later; a device that was never scanned in this process is looked up with
  `retrievePeripherals(withIdentifiers:)`, and Android uses `getRemoteDevice(address)`.
