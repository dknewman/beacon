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
device to `failed`, and native always sends them before the `disconnected` they cause. Operation-level
codes (`read_failed`, `write_failed`, `subscription_failed`) are the exception: they describe one GATT
operation, not the link, so the connection machine leaves the state alone and the operation's own
promise or the subscription state carries the failure.

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

## GATT table (`GattStatus`) — M4

```text
idle ──discovery_requested──► discovering ──discovery_succeeded──► ready(services)
discovering ──discovery_failed──► failed
any ──link_ended──► idle
```

Native discovers the whole table (services, then every service's characteristics) while
connecting, so `discoverServices` returns a cached copy for a `ready` link and rejects with
`disconnected` otherwise. `GattProvider` keeps one copy per device above navigation, fetches it
as soon as the connection is `ready`, and drops it (`link_ended`) whenever the connection
coordinator reports the device left `ready`, so a stale table never outlives its link.
Implemented in `features/gatt/gattReducer.ts`.

## Characteristic operation (`CharacteristicOperationState`) — M5

```text
idle ──read_started──► reading ──read_succeeded / read_failed──► idle (lastOutcome)
idle ──write_started──► writing ──write_succeeded / write_failed──► idle (lastOutcome)
any ──reset──► idle
```

One state per characteristic screen, owned by `useCharacteristicOperations`. `busy` is
`idle | reading | writing`; `read_started` and `write_started` are ignored unless `busy` is
`idle`, so a second tap while an operation is in flight is a no-op and the UI never has two
operations outstanding. Every completion returns to `idle` and records `lastOutcome`: the kind
(`read` or `write`), whether it succeeded, the byte count or the `BleError`, the write mode and
the time. The status row shows "Reading…" / "Writing…" while busy and the outcome afterwards
(`describeOutcome`), including the contract code for a failure. Controls are additionally gated
on the connection being `ready` and on the characteristic's properties (`read`, `write`,
`write_without_response`); a missing property hides the control, a non-ready link disables it
with a reason. Implemented in `features/gatt/characteristicOperations.ts`.

## Packet log (`PacketLogState`) — M5

```text
packet_recorded  { packet }   ──► prepend to packets[deviceId], drop beyond 500
packets_recorded { packets }  ──► prepend the batch per device, newest first, drop beyond 500 (M6)
log_cleared      { deviceId } ──► remove packets[deviceId]
```

A per-device ring buffer of `BlePacket` (id, timestamp, device, service and characteristic
UUIDs, `incoming | outgoing`, bytes as `number[]`), newest first, capped at
`DEFAULT_PACKET_LOG_CAPACITY` (500). `useCharacteristicOperations` records a successful read
as `incoming` and a successful write as `outgoing`; failures are not packets and stay in
`lastOutcome`. `PacketLogProvider` holds the log above navigation so the history survives
screen changes and outlives the link: losing the connection keeps the packets and the last
value on screen while the controls go with the table. Implemented in
`features/packets/packetLogReducer.ts`; the M6 value pipeline records notifications in
batches (`packets_recorded`, one dispatch per flush) and the M7 parsers read from the same
log.

### Parsed values — M7

Parsing adds no machine. A parsed value is a pure function of a packet
(`parsePacket(packet)` in `features/parsers`, over `@beacon/protocol-parsers`): the packet's
UUIDs are the parser context, the bytes are the input, and the result is a `ParseOutcome`
computed at render time for the latest packet and for each listed row. Nothing is stored,
so there is no parsed state to reconcile with the log, the flush or the link; a packet that
fails to parse stays a packet, with the reason derived from it on every render (ADR 0008).
Every machine above is unchanged.

### GATT queue and the connection machine

Native serializes reads, writes and subscription changes per peripheral in
`GattOperationQueue` (ADR 0006): an operation starts when the queue is idle, otherwise waits
for the predecessor's callback. `setNotify` is one of them: `setNotifyValue` on iOS and the
descriptor write on Android are GATT requests like a read, answered by their own callbacks. A
call made while the device is not `ready` rejects with `disconnected` without being queued.
When the link ends for any reason, the owner cancels the queue and settles every in-flight and
pending completion with `disconnected`; as with every device-scoped error, the `ble.error`
event arrives before the `disconnected` transition, so the connection machine records
`lastError` and the operation state records the same code in `lastOutcome`.

## Subscriptions (`SubscriptionsState`) — M6

```text
off|absent ──subscribe_requested──► subscribing (notificationCount reset) ──subscribe_succeeded──► on
subscribing ──subscribe_failed──► off (lastError)
on ──unsubscribe_requested (lastError cleared)──► unsubscribing ──unsubscribe_succeeded──► off
unsubscribing ──unsubscribe_failed──► on (lastError)
any|absent ──values_received { counts: [{ key, count, at }] }──► same phase (notificationCount += count, lastValueAt = at)
any ──link_ended { deviceId }──► every entry of the device removed
```

One `CharacteristicSubscription` per key `deviceId/serviceUuid/characteristicUuid`
(`subscriptionKey`), holding `phase` (`SubscriptionPhase`), `notificationCount` (values since
the subscription was last turned on), `lastValueAt` and `lastError`; `subscriptionOf` answers
`off` with a zero count for a key with no entry. `subscribe_requested` is ignored unless the
entry is `off` and `unsubscribe_requested` unless it is `on`, so a second tap while
`setNotify` is in flight is a no-op, and every acknowledgement is ignored unless the entry is
in the phase that asked for it. The phase changes on the promise, not on the tap: `setNotify`
resolves only once the peripheral acknowledged the change (`didUpdateNotificationStateFor`
on iOS, the Client Characteristic Configuration descriptor write on Android), so `on` means
the peripheral agreed to push values. A failed subscribe returns to `off` with the contract
code in `lastError`; a failed unsubscribe stays `on` with `lastError`, because native still
delivers values. `values_received` counts under any phase, and creates an entry for a
characteristic the app never subscribed to, so the screen shows what is actually arriving.
`link_ended` removes every entry of the device. Implemented in
`features/subscriptions/subscriptionReducer.ts` (`subscriptionsReducer`), with the status row
text in `describeSubscription` ("Off" / "Failed" with the reason / "Subscribing…" / "On" with
"N notifications received." / "Unsubscribing…"); driven by `SubscriptionProvider`, the only
caller of `GattNotifyApi` (ADR 0007).

Gate: the screen offers Subscribe only for a characteristic with `notify` or `indicate` and a
`ready` link, with "Subscribing…" / "Unsubscribing…" as the button label while the call is in
flight; native refuses anything else with `subscription_failed` ("Notifications not
supported") before queueing.

### Value pipeline

```text
characteristic.value_changed ──► createPacket (incoming, native timestamp) ──► ref buffer (no React state)
                                                                                 │ flushed at most every 100 ms
                                                                                 ├──► packets_recorded { packets }                  one batch into the packet log
                                                                                 └──► values_received { counts: [{ key, count, at }] }  one action, one entry per characteristic
```

`SubscriptionProvider` is the only listener for `characteristic.value_changed`. Events are
appended to a ref buffer and flushed at most every 100 ms (`flushIntervalMs`, default
`DEFAULT_FLUSH_INTERVAL_MS`): one `packets_recorded` batch into the packet log (`recordMany`,
capacity still 500 per device) and one `values_received` action with a count per
characteristic, so a 100 Hz stream causes at most ten renders per second (PROJECT.md 17, 37)
and the value columns and packet list on the characteristic screen update from the same
batched log as reads and writes. Every value is an `incoming` packet; its timestamp is the one
native took at receipt (ADR 0007), so buffering delays the display, not the record. Failures
are not packets: a rejected `setNotify` lives in the entry's `lastError`.

### Subscriptions and the connection machine

Native drops every subscription with the link and does not report them ending one by one
(CoreBluetooth forgets `isNotifying` with the connection; Android's descriptor state lives on
the closed client). The provider therefore watches the connection machine and dispatches
`link_ended` for every device with entries whose connection is not `ready`: a remote drop,
adapter loss or a disconnect the user asked for. A `setNotify` in flight when the link ends is
settled with `disconnected` by the queue cancellation, after the device-scoped `ble.error` and
before the `disconnected` transition, so the connection machine records `lastError` first;
the late rejection finds its entry already removed and is ignored. Reconnecting starts from
`off`, as native does.

## Session recording (`RecorderState`) — M8

```text
idle ──start_requested──► starting ──start_succeeded { session }──► recording ──stop_requested──► stopping ──stop_succeeded { endedAt }──► idle (lastSession)
starting ──start_failed──► idle (lastError)
stopping ──stop_failed──► idle (lastSession, lastError)
recording|stopping ──events_appended { sessionId, eventCount, packetCount }──► same phase (counts added)
recording|stopping ──append_failed { sessionId, droppedCount, error }──► same phase (droppedCount added; lastError while recording)
any ──sessions_changed──► every device unchanged, revision + 1
```

One `DeviceRecording` per device (`recordingOf` answers `idle` for a device with no entry),
holding the phase, the open `session` while `recording` or `stopping`, and three counts:
`eventCount` and `packetCount` are what the repository has acknowledged, `droppedCount` is
what a failed append lost. `start_requested` is ignored unless the device is `idle`,
`stop_requested` unless it is `recording`, and every acknowledgement is ignored unless the
device is in the phase that asked for it and the `sessionId` matches, so a late result for a
session that already ended cannot touch the next one. `stop_succeeded` and `stop_failed`
both return to `idle` with `lastSession` carrying the acknowledged counts; a failed stop also
keeps `lastError`, and the row stays open until the next launch closes it (below). The
state's `revision` bumps on `start_succeeded`, `stop_succeeded` and `sessions_changed`
(recovery closed a session, or a screen deleted one) so the history list refetches without
polling. Implemented in `features/sessions/sessionRecorderReducer.ts`; driven by
`SessionRecorderProvider` (ADR 0009).

A session is explicit: it starts and ends with Start and Stop on the Device Detail screen,
not with the link. A device that drops and reconnects while recording produces `connection`
events inside one session. Two devices record independently.

### Activity bus and the write path

```text
coordinator ──publish { deviceId, ...SessionEventInput }──► ActivityBus (synchronous fan-out, no history)
                                                              │ SessionRecorderProvider, while starting | recording
                                                              ▼
                                                     per-device ref buffer (no React state)
                                                              │ flushed every 250 ms, or at once at 200 events
                                                              ▼
                                            repository.appendEvents(sessionId, batch)   one transaction, serialized per device
                                                     ├─ resolved ──► events_appended
                                                     └─ rejected ──► append_failed (batch dropped, session still open)
```

`ConnectionProvider` publishes every `connection` transition, every device-scoped `error`
(native ones and the ones JavaScript raises, such as the 15 s connect timeout) and every
`rssi` reading; `GattProvider` publishes `services_discovered`; `SubscriptionProvider`
publishes `subscription` on the peripheral's acknowledgement and one `notification` per value
at its 100 ms flush, with the native timestamp; `useCharacteristicOperations` publishes a
successful `read` and `write`. Failed reads, writes and subscription changes are not
published; they stay in the operation outcome and the subscription entry as before.

The recorder captures from `start_requested`, so events published while the session row is
being created wait in the buffer and are appended, in order, once the id exists; while
`idle` or `stopping` the buffer is dropped. Appends for one device run one after another,
so sequence numbers follow the order of publication even when a slow write overlaps the next
flush. `stop_requested` flushes what is buffered before `endSession` is called, so nothing
published before the tap is lost.

### Recovery and the connection machine

Recording does not watch the connection machine: a link leaving `ready` is a `connection`
event in the timeline, not the end of the session. What ends a session other than Stop is
the next launch: `recoverOpenSessions` runs when the recorder mounts and ends every session
without `endedAt` at its newest event, or at its start when it holds none, then dispatches
`sessions_changed`. Every machine above is unchanged by M8; the recorder only listens.

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
rather than silently dropped. `characteristic.value_changed` is timestamped natively at
receipt (ADR 0007) and is the only event the application layer buffers rather than applying
at once.
