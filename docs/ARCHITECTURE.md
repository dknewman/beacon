# Architecture

Beacon is a monorepo with one React Native application and shared TypeScript packages. The
guiding constraint is PROJECT.md section 3: Bluetooth logic lives in native platform code; React
Native consumes a narrow typed bridge; state is explicit.

## Layers

| Layer          | Location                                                                          | Owns                                                                                                 | Must not                                 |
| -------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| UI             | `apps/mobile/src/features/**/*Screen.tsx`, `src/components`, `src/app/navigation` | Rendering, accessibility, user intent, routes by id                                                  | Call the bridge directly, hold BLE state |
| Application    | `apps/mobile/src/features/**` (reducers, hooks, coordinators, providers)          | Explicit state machines, orchestration, buffering                                                    | Import platform APIs                     |
| Contracts      | `packages/ble-contracts`                                                          | Domain models, state unions, error codes, `NativeBleClient` segments, `NativeBleEvent`               | Depend on React Native                   |
| Validation     | `packages/validation`                                                             | zod schemas for every boundary payload and for parser output, `ValidationResult`                     | Know about UI                            |
| Parsers        | `packages/protocol-parsers`                                                       | `ByteReader`, the SIG and text parsers, the registry, `ParseOutcome`                                 | Import UI or application code            |
| Export         | `packages/session-export`                                                         | JSON and CSV serializers, canonical key order, file names, `ExportErrorCode`                         | Touch a file system or the bridge        |
| Storage        | `apps/mobile/src/storage`                                                         | `SqlDatabase` surface, op-sqlite binding, versioned migrations                                       | Know the domain: rows in, rows out       |
| Bridge wrapper | `apps/mobile/src/native`                                                          | Codegen specs, `createNativeBleClient` / `createNativeExportClient`, injection contexts, mock client | Contain BLE or export policy             |
| Native         | `apps/mobile/ios/BeaconBluetooth`, `apps/mobile/android/.../bluetooth`            | CoreBluetooth / BluetoothGatt, GATT queue, event emission, error mapping                             | Trust JS for connection state            |
| Native export  | `apps/mobile/ios/BeaconExport`, `apps/mobile/android/.../export`                  | The temporary export directory, path containment, the platform share sheet                           | Know what a session is                   |

Dependency direction is strictly downward in the table. `packages/*` never import from
`apps/mobile`. Among the packages the direction is `ble-contracts` ← `validation` ←
`protocol-parsers` ← `apps/mobile`: the contracts know nothing of validation, validation
knows nothing of the parsers, and the parsers know nothing of the app. `session-export` sits
next to the parsers on `ble-contracts` and `validation` and likewise knows nothing of the app:
it turns a session into text, and something else decides where the text goes.

## Data flow (M0–M9)

```text
NavigationContainer ─ DeviceListScreen ──► DeviceDetailScreen ──► GattInspectorScreen ──► CharacteristicDetailScreen
   ▲ reads                                 ▲ reads by id, polls RSSI      ▲ reads the cached table by id   ▲ reads, writes, subscribes, lists packets
   │                                       │ Start / Stop session ──► SessionHistoryScreen ──► SessionDetailScreen      │ parsePacket / packetSummary (@beacon/protocol-parsers) over the packet log, at render time
   │                                       ▼                          ▲ listSessions (refetch on revision)  ▲ getSession + listEvents, summarizeSession, live while recording
   │                                                                                                       │ Export JSON / Export CSV (disabled while recording)
   │                                                                                                       ▼
   │                                                                    useSessionExport: export machine (idle → preparing → sharing), one at a time
   │                                                                       │ getSession + listEvents (the whole session, not the loaded page)
   │                                                                       │ toJsonExport / toCsvExport, exportFileName, EXPORT_MIME_TYPES (@beacon/session-export)
   │                                                                       ▼
   │                                                                    createNativeExportClient ── writeTemporaryFile / shareFile / clearTemporaryFiles ──► NativeBeaconExport
SessionRecorderProvider: per-device recording machine, per-device buffer, 250 ms / 200-event appends ──► SessionRepository (SQLite via op-sqlite, opened lazily) ── storage/SqlDatabase ── migrations (user_version)
   ▲ subscribe
ActivityBus: publish { deviceId, ...SessionEventInput }  ◄── connection / error / rssi ── services_discovered ── read / write ── subscription / notification
   ▲                                              ▲                    ▲                     ▲                    ▲                                     ▲
ScanProvider: readiness + scan + device cache   ConnectionProvider: per-device machine   GattProvider: per-device table   PacketLogProvider: per-device ring buffer   SubscriptionProvider: per-characteristic subscription, 100 ms flush
   ▲                                              ▲                    ▲                     ▲                    ▲ useCharacteristicOperations        ▲ recordMany (batched) ─────────┘
   │ BluetoothAdapterApi / PermissionApi          │ ScanApi            │ ConnectionApi       │ GattDiscoveryApi   │ GattValueApi (read / write)         │ GattNotifyApi (setNotify)
   │                                              │ scan.device_discovered / ble.error (no deviceId)
   │                                              │                    │ connection.state_changed / ble.error (deviceId)
   │                                                                                                                                                    │ characteristic.value_changed (native timestamp)
createNativeBleClient
   │ parseBluetoothState / parseBlePermissionState / parseNativeBleEvent (zod)
   │        ← invalid → BleError("invalid_payload") / ble.error event
   ▼
NativeBeaconBluetooth (Turbo Module spec, codegen)
   │
   ├─ iOS: BeaconBluetoothModule.mm → BluetoothManager.swift (+ PeripheralSession, GattOperationQueue) → CBCentralManager / CBPeripheral
   └─ Android: BeaconBluetoothModule.kt → BluetoothController / BleScanner / ConnectionRegistry (+ DeviceConnection, GattOperationQueue) → BluetoothAdapter / BluetoothLeScanner / BluetoothGatt

NativeBeaconExport (second Turbo Module spec, codegen)
   │ rejections carry ExportErrorCode; createNativeExportClient maps them with toExportError
   ├─ iOS: BeaconExportModule.mm → ExportManager.swift (+ ExportFileStore, ShareSheetPresenter) → UIActivityViewController
   └─ Android: BeaconExportModule.kt (+ ExportFileStore) → FileProvider "${applicationId}.exports" → Intent.createChooser
```

Ordering rule: subscribe to events before the initial read so a transition during the read is
not lost. Late results after unmount are ignored by an `active` flag in the effect. The scan
coordinator is the only caller of `ScanApi`, the connection coordinator the only caller of
`ConnectionApi`, `useCharacteristicOperations` the only caller of `GattValueApi`, and the
subscription provider the only caller of `GattNotifyApi`, and the session recorder the only
subscriber of the activity bus and the only writer of the session repository, and
`useSessionExport` the only caller of the export client; screens express intent (`start`,
`stop`, `connect`, `disconnect`, `read`, `write`, `subscribe`, `unsubscribe`, `startSession`,
`stopSession`, `exportSession`) and read derived state. The coordinators live above the
navigator (ADR 0005), so scanning, links, subscriptions, the packet history and a running
recording survive screen changes.

Provider order in `App.tsx`, outermost first: `ExportClientProvider` → `BleClientProvider` →
`ActivityBusProvider` → `ScanProvider` → `ConnectionProvider` → `GattProvider` →
`PacketLogProvider` → `SubscriptionProvider` → `SessionRecorderProvider` → navigation. Each
provider may read the ones above it (the GATT provider watches the connection machine to drop
a table with its link; the packet log is written by the characteristic operations hook
underneath it and by the subscription provider's flush; the subscription provider watches the
connection machine to drop subscriptions with their link; the connection, GATT and
subscription providers and the characteristic operations hook publish to the activity bus
above them; the recorder below them all subscribes to it) and never the ones below. A
coordinator that publishes must sit between the bus and the recorder. The export client is
outermost because it depends on nothing else: the export path reads the session repository and
the platform, never the radio, so it has no reason to sit inside the BLE client and no
ordering constraint against the coordinators.

## GATT operations and the packet log (M5)

`features/gatt/characteristicOperations.ts` is the per-characteristic operation reducer
(`busy: idle | reading | writing`, `lastOutcome`) and its status text;
`useCharacteristicOperations.ts` drives one read or write at a time through `GattValueApi`,
records a successful read as an `incoming` packet and a successful write as an `outgoing` one,
and keeps failures in the outcome. `CharacteristicDetailScreen.tsx` composes them with
`WriteForm.tsx` (HEX / Decimal / UTF-8 input, parsed on every keystroke with the validation
message or byte preview, write buttons per property) and `ValueColumns.tsx` (HEX, DECIMAL,
BINARY, ASCII, UTF-8 for the latest packet).

`features/packets/` is the shared history: `packetLogReducer.ts` (per-device ring buffer of
`BlePacket`, newest first, capacity 500, `createPacket` ids), `PacketLogProvider.tsx` (above
navigation; `record`, `clear`, `packetsOf`, `packetsForCharacteristic`) and
`packetPresentation.ts` (row labels with millisecond times). Byte encoding and the write-form
parsers live in `@beacon/ble-contracts` (`bytes.ts`) so the protocol parsers (M7) and the M8
recorder work on the same `number[]` representation that crosses the bridge (ADR 0006).

## Subscriptions and the buffered value pipeline (M6)

`features/subscriptions/subscriptionReducer.ts` is the per-characteristic subscription
reducer (`subscriptionsReducer` over `SubscriptionsState`, one `CharacteristicSubscription`
per `deviceId/serviceUuid/characteristicUuid` key: `phase: off | subscribing | on |
unsubscribing`, `notificationCount`, `lastValueAt`, `lastError`) and the status row text
(`describeSubscription`). `SubscriptionProvider.tsx` sits above navigation and is the only
caller of `GattNotifyApi` (`useSubscriptions()`: `subscriptionOf`, `subscribe`,
`unsubscribe`): it moves an entry to `subscribing` / `unsubscribing` while `setNotify` is in
flight, to `on` / `off` when the peripheral's acknowledgement resolves the promise, keeps a
rejection in `lastError`, and drops every entry of a device (`link_ended`) when the connection
coordinator reports the device is no longer `ready`, because native drops the subscriptions
with the link (ADR 0007).

Incoming `characteristic.value_changed` events never touch React state one by one
(PROJECT.md 17, 37). The provider turns each into an `incoming` packet with the native
timestamp, appends it to a ref buffer and arms one timer (`flushIntervalMs`, default 100);
when it fires, the buffer is flushed with one `packets_recorded` batch into the packet log
(`PacketLogProvider.recordMany`) and one `values_received` action carrying a count and the
newest timestamp per characteristic, so a 100 Hz stream causes at most ten renders per second
and the log stays bounded at 500 packets per device. Timestamps are taken natively at receipt,
so buffering changes when a value is shown, never when it is recorded as having arrived.
`CharacteristicDetailScreen.tsx` reads the entry for its Subscribe / Unsubscribe button (shown
for `notify` or `indicate`, enabled only with a `ready` link, labelled "Subscribing…" /
"Unsubscribing…" while busy) and its "Notifications" row (phase and count, with the failure
reason and code when a change was refused); the value card says when the latest value was
received, and the value columns and the packet list update from the same batched log as reads
and writes. Failures are reported in the row, not logged as packets.

## Protocol parsers (M7)

`packages/protocol-parsers` (`@beacon/protocol-parsers`) turns characteristic bytes into a
`ParsedValue` (`@beacon/ble-contracts` `parsed-value.ts`: `parserId`, `label`, one-line
`summary`, `fields` of `{ name, value, unit? }`). `reader.ts` is a bounds-checked
little-endian `ByteReader` (`uint8`, `uint16`, IEEE 11073 SFLOAT with its special values, the
seven-byte Date Time, `expectEnd`) whose every failure is a `ParseError` naming the field.
`parsers/` holds one `BleParser` per characteristic, matched on the canonical characteristic
UUID in the `ParserContext`: `batteryLevel` (`2A19`), `heartRateMeasurement` (`2A37`),
`weightMeasurement` (`2A9D`), `bloodPressureMeasurement` (`2A35`), `utf8Text` (the SIG string
characteristics and the Nordic UART lines) and `rawBytes`, which matches everything and never
fails. `registry.ts` is `createParserRegistry(parsers)`: first match in registration order,
the raw fallback appended when missing, `parse(bytes, context)` accepting the bridge's
`number[]` or a `Uint8Array` and returning a `ParseOutcome`, `{ ok: true, value }` or
`{ ok: false, parserId, reason, fallback }`; a thrown `ParseError` and a result
`parsedValueSchema` rejects both become the failed outcome carrying the raw fallback.
`standardParsers` and `defaultParserRegistry` are the PROJECT.md 19 set, most specific first
(ADR 0008). The package imports nothing from the app or from React.

`apps/mobile/src/features/parsers/` is the glue: `parsePacket(packet, registry)` builds the
context from the packet's UUIDs, `presentableValue` hides a plain raw reading (the HEX column
already shows it) but keeps a failed parse with its reason, `packetSummary` gives a row its
one line, `formatField` renders a field with its unit; `ParsedValueView.tsx` shows the
label, the summary, an error line naming the parser and reason when parsing failed, then the
fields. `CharacteristicDetailScreen.tsx` renders it above the value columns for the latest
packet and a summary on each packet row (also in the row's accessibility label). Parsing is
stateless and happens at render time over the packet log: no parsed-value state, no
reducer, nothing to keep in sync with the 100 ms flush; the screen lists at most 20 packets,
so the cost is bounded and small next to the five encodings the value columns compute.

## Session recording (M8)

### Storage

`apps/mobile/src/storage/` is the SQL layer and knows nothing about sessions.
`SqlDatabase.ts` is the whole surface the repositories use: `execute(sql, params)` returning
rows of `string | number | null`, `transaction(work)` (commit on resolve, roll back on
throw) and `close()`. `createOpSqliteDatabase.ts` binds an `@op-engineering/op-sqlite`
connection to it, declaring the slice of the library it needs as its own interface so the
binding is testable with a plain object, and narrows row values (booleans to 0/1, blobs to
hex). `openAppDatabase.ts` is the only module that imports the library and opens
`beacon.sqlite`. `migrations.ts` holds `SCHEMA_MIGRATIONS`, an append-only list of
`{ version, description, statements }`; `migrate` reads `PRAGMA user_version`, applies
every migration above it in order, each in its own transaction that ends by setting the
version, and rejects duplicates. Version 1 creates `sessions` (indexed by `started_at DESC`,
with `packet_count` and `event_count` kept on the row) and `session_events` (`session_id`
with `ON DELETE CASCADE`, `sequence`, `timestamp`, `kind`, a JSON `payload`, primary key
`(session_id, sequence)`). Under Jest the same interface is implemented by
`tests/fakes/SqlJsDatabase.ts` over sql.js, so the migrations and every repository statement
run against a real SQLite engine without a native module (ADR 0009).

`features/sessions/SessionRepository.ts` is the boundary the recorder and the screens see:
`createSession`, `appendEvents` (in order, next sequence numbers, atomic per call),
`endSession`, `getSession`, `listSessions` (newest first), `listEvents` (ascending, paged by
`fromSequence` / `limit`) and `deleteSession`, plus `SessionNotFoundError`,
`createSessionId` (sortable, process-unique) and `eventIdOf`. `InMemorySessionRepository`
is the reference implementation and what `App` tests use; `SqliteSessionRepository` stores
each event's `SessionEventInput` as JSON in `payload`, updates the counts in the same
transaction as the append, and validates every row it reads back with `parseBleSession` /
`parseSessionEventInput` (`@beacon/validation`), skipping and reporting (`onInvalidRow`) a
row that fails. Both run `sessionRepository.contract.ts`. `prepareSessionDatabase` turns
`PRAGMA foreign_keys` on and migrates; `createLazySessionRepository` defers that open to
the first call so the composition root stays synchronous and a database that cannot be
opened surfaces as a failed operation with its message, retried on the next call.
`recoverOpenSessions` ends every session a previous run left open at its newest event (or
its start when empty).

### Activity bus

`features/activity/activityBus.ts` is an in-process publish/subscribe of `DeviceActivity`,
`{ deviceId } & SessionEventInput` (`@beacon/ble-contracts` `session.ts`: `connection`,
`rssi`, `services_discovered`, `subscription`, `read`, `write`, `notification`, `error`,
each with an ISO timestamp). `createActivityBus` is a synchronous fan-out with no history and
no replay; a listener that throws does not stop the others. `ActivityBusProvider` sits
directly under `BleClientProvider` so every coordinator publishes to one bus:
`ConnectionProvider` publishes every connection transition, every device-scoped error
(native and the JavaScript-raised ones, such as the connect timeout) and every RSSI reading;
`GattProvider` publishes `services_discovered` with the service and characteristic counts;
`SubscriptionProvider` publishes `subscription` on the peripheral's acknowledgement and one
`notification` per value at its flush, with the native timestamp; `useCharacteristicOperations`
publishes a successful `read` and `write`. Failed operations are not published; they stay
in the outcome and the subscription entry as before. The recorder is the only subscriber.

### Recorder

`features/sessions/sessionRecorderReducer.ts` is the per-device recording machine
(`idle | starting | recording | stopping`, with the open session, the acknowledged
`eventCount` and `packetCount`, the `droppedCount` of a failed append, `lastSession` and
`lastError` once idle again) and `RecorderState.revision`, which bumps whenever the set of
stored sessions changes so lists refetch. `SessionRecorderProvider.tsx` sits below every
publisher and above navigation, subscribes to the bus, and persists per device everything
between `startSession(deviceId, deviceName?)` and `stopSession(deviceId)`: capture begins
at the start request (events wait in a ref buffer until the row exists), the buffer is
appended in one transaction every 250 ms (`DEFAULT_SESSION_FLUSH_INTERVAL_MS`) or at once at
200 events (`DEFAULT_MAX_BUFFERED_EVENTS`), store operations for one device run strictly one
after another so sequence numbers follow the order of publication, a rejected append drops
that batch, counts it and keeps recording, Stop writes the remaining buffer before ending the
row, and sessions an earlier run left open are closed on mount. Sessions are explicit and
not tied to the link: a dropped and re-established connection stays in one session. The
provider exposes `useSessionRecorder()`: `state`, `recordingOf`, `startSession`,
`stopSession`, the `repository` for screens that list and read, and
`notifySessionsChanged` for a delete. `sessionStatistics.ts` (`summarizeSession(session,
events)`) is pure: duration (to `endedAt`, or to the newest event while open), counts by
kind, packets, bytes received and sent, notifications per second, RSSI min / max / average
and sample count, and per-characteristic traffic (reads, writes, notifications, bytes, first
and last time) busiest first, so the numbers can be recomputed identically from an export.

### Screens and routes

`features/sessions/sessionPresentation.ts` is the pure text of the session screens
(`describeSessionEvent` for a timeline row: an upper-case kind such as `CONNECTED`,
`SERVICES DISCOVERED` or `NOTIFICATION` with its detail, `labelPath` as `180D / 2A37` with
vendor UUIDs kept in full, `describeRecording` and `describeSessionAction` for the Session
row and its one control, `labelSession`, `formatDuration`, `formatSessionStart`);
`useLoadState.ts` is the `loading | ready | failed` state of a screen that reads from the
repository, re-running its load when a key changes or the screen is focused, dropping a
result that arrives after a newer request, keeping the rows already shown while the next
read runs, and offering `retry`.

`DeviceDetailScreen` gains a Session row (`describeRecording`: "Not recording" with the
last session's counts, "Starting", "Recording" with live event and packet counts and any
dropped count or error, "Stopping"), one button that is Start session while idle and Stop
session while recording ("Starting…" / "Stopping…" disabled in between), and a "Session
history" link to this device's sessions; `DeviceListScreen` gains a "Sessions" link to all
of them. `SessionHistoryScreen` (`SessionHistory { deviceId? }`) lists sessions newest first,
filtered to one device when `deviceId` is given, one row per session (device name or id,
start, duration or "Recording", packet count, a Recording badge while open), refetches on
the recorder's `revision` and on focus, and shows Loading, Failed with Try again, or an
empty-state hint. `SessionDetailScreen` (`SessionDetail { sessionId }`) reads the session
and its events, renders the statistics card (`summarizeSession`: duration, "so far" while
live, events, packets, bytes received and sent, notification rate, RSSI), the
Characteristics card (busiest first) and the timeline as one `FlatList` of event rows
(time, kind, detail) with everything else as the list header; while the recorder still holds
that session open the load is keyed on the acknowledged event count, so the timeline grows
in place. Delete (`deleteSession`, then `notifySessionsChanged`, then back) is offered only
for an ended session; a deleted or unknown id shows "Session not found". Routes carry
identifiers only, as before, and the screens read through `useSessionRecorder().repository`.

## Export (M9)

### Serializers

`packages/session-export` (`@beacon/session-export`) turns a `BleSession` and its
`SessionEvent`s into text and knows nothing else: no file system, no bridge, no React, the
same isolation the parser package has. `json.ts` writes the full-fidelity document
(PROJECT.md 21) — `version` (`JSON_EXPORT_VERSION`, 1), `generator`, `exportedAt`, `session`,
`events` — and `parseJsonExport` reads one back through `parseBleSession` and
`parseSessionEvent` (`@beacon/validation`), the same runtime schemas the repository validates
its own rows with, so a truncated or hand-edited file fails at the boundary naming the field
or the event index. `canonical.ts` rebuilds the session and every event kind with their keys
in a fixed order, omitting absent optional fields rather than writing `null`, on both the
write and the read path: JSON key order is not semantically meaningful, but a fixed one makes
the output byte-stable, so two exports of a session are the same file and re-exporting a
parsed document reproduces it. That is what lets a diff, a checksum or a signature over an
export mean anything, and the tests hold both paths to it (ADR 0010).

`csv.ts` writes the human-readable one: a `field,value` summary block naming the session, a
blank line, then the `sequence,timestamp,kind,service,characteristic,detail,bytes,byteCount`
header and one row per event, with SIG UUIDs shortened to `180D` / `2A37` (vendor UUIDs kept
in full, `fullUuids` to keep every one), bytes as hex with a count, and a readable `detail`
for the kinds that carry none. Columns a kind does not use are left empty rather than filled
with a placeholder, so they stay sortable. Fields are quoted per RFC 4180 (a comma, a quote or
a newline wraps the field and doubles its quotes), rows end with CRLF including the last, and
a value beginning with a character a spreadsheet would treat as a formula is prefixed with a
quote, so nothing that arrived over the air can execute when the file is opened.
`fileName.ts` names the file `beacon-<device>-<start>.<format>`, sanitized to what every file
system accepts, and maps each format to its media type; `errors.ts` holds `ExportErrorCode`
and `toExportError`.

### Bridge and machine

`src/native/specs/NativeBeaconExport.ts` is a second Turbo Module spec with three calls —
`writeTemporaryFile`, `shareFile`, `clearTemporaryFiles` — because writing a file and
presenting a share sheet are not Bluetooth operations and do not belong on `BeaconBluetooth`
(docs/NATIVE_BRIDGE.md, ADR 0010). `createNativeExportClient` wraps it in the `ExportClient`
contract, type-checks what comes back (a module that returns no path or a non-boolean means
the spec and native disagree, which is surfaced rather than coerced) and maps every rejection
with `toExportError`. `ExportClientProvider` injects it, outermost of the providers.

`features/export/exportReducer.ts` is the per-session machine: `idle` (with the previous
`lastOutcome`), `preparing` while the document is built and written, `sharing` while the sheet
is open. A request that arrives while anything is in flight is ignored rather than queued —
one export at a time, because two sheets cannot be presented at once — and
`useSessionExport(repository, sessionId)` guards the same rule with a ref so a second press
cannot slip through before the re-render. The hook reads the session and every event from the
repository itself rather than taking them from the screen, so the document is always the whole
session and not the page the timeline happens to have loaded; it then serializes, writes the
temporary file, moves to `sharing`, and settles on the share's answer.
`exportPresentation.ts` is the pure text: button labels per format ("Export JSON",
"Preparing JSON…", "Sharing CSV…"), the status line, and `EXPORT_PRIVACY_NOTE`. A completed
share is reported as the file having been "handed to the share sheet", never as delivered,
because that is the most either platform can prove; a dismissal is reported only when the
platform actually saw one, which is iOS.

`ExportControls.tsx` renders the two buttons, the status line as a polite live region and the
privacy note, and `SessionDetailScreen` puts it in the footer above Delete. A session the
recorder still holds open disables both buttons with "Stop the session before exporting it, so
the file holds the whole recording": a file holding part of a session is worse than no file.
Export is explicitly user-initiated (PROJECT.md 35) — there is no automatic path into this
machine at all.

## Composition root

`apps/mobile/src/app/bootstrap.tsx` is the only file that references the real Turbo Modules
and the on-device database. It creates the validated BLE client and injects it through
`BleClientProvider`, or, when `USE_MOCK_BLE_CLIENT` is set in `runtimeOptions.ts`, the
scripted mock client from `src/mock`; it wraps `NativeBeaconExport` in
`createNativeExportClient` for `ExportClientProvider`; and it builds the session repository as
`createLazySessionRepository` over `openAppDatabase` + `prepareSessionDatabase` +
`SqliteSessionRepository`, so SQLite is opened and migrated on first use and sessions are
real even with the mock radio. `App` takes all three as props. Tests render `App` with
`FakeBleClient`, which keeps every native call pending until the test settles it,
`InMemorySessionRepository`, and `FakeExportClient`, which keeps the write and the share
pending the same way.

## Contract segmentation

`NativeBleClient` is composed from `BluetoothAdapterApi`, `PermissionApi`, `ScanApi`,
`ConnectionApi` and `GattApi`. Each milestone ships a complete implementation of one segment in
TypeScript, Swift and Kotlin, rather than stubbing unimplemented methods with fake successes.
`GattApi` is itself split: `GattDiscoveryApi` (M4), `GattValueApi` (M5: `readCharacteristic`,
`writeCharacteristic`) and `GattNotifyApi` (M6: `setNotify`). `BleClient` (the app's type) was
the intersection of the segments implemented so far; since M6 every segment has a native
implementation, so `BleClient` equals `NativeBleClient` and stays as the one name screens and
tests depend on. `ExportClient` (M9) is a separate contract over a separate Turbo Module, not
another segment of this one, and is composed nowhere into `BleClient`.

## State management

State is separated by responsibility (PROJECT.md 5). M0 introduced the adapter reducer, M1 the
permission reducer and readiness projection, M2 the scan reducer, device cache and in-memory
filters, M3 the per-device connection reducer, M4 the per-device GATT table tied to the link,
M5 the per-characteristic operation reducer and the per-device packet log, M6 the
per-characteristic subscription reducer with its value buffer; M7 adds no state, because
parsed values are derived from the packet log at render time; M8 the per-device recording
reducer, whose source of truth for what was written is the session repository rather than
React state; M9 the per-session export machine, which is local to the session detail screen
because an export is one screen's action and outlives nothing; UI state and persisted
preferences each get their own module as their
milestones land. There is no global store: each concern is a reducer behind a provider or
hook, and screens compose them.

## Platform differences

Handled explicitly in native code and documented at the contract:

- `BluetoothState.unauthorized` is a native adapter state on iOS only; Android expresses it as a
  permission result.
- `BluetoothState.resetting` is iOS only; Android's transitional turning on/off states are
  reported as `powered_off`.
- Device identifiers are `CBPeripheral.identifier` UUIDs on iOS and MAC addresses on Android and
  are not portable across devices.
- UUID formatting differs; `normalizeUuid` produces one canonical form at the boundary.
- Scan callbacks differ (iOS reports once per peripheral unless duplicates are requested; Android
  reports every advertisement and rate-limits scan starts). ADR 0004 records how M2 handles both.
- Manufacturer data: iOS hands over the raw bytes, Android splits them by company id;
  `ScanResultMapper` re-serializes the Android form with the little-endian company id so both
  platforms produce the same hex string.
- Service discovery: Android hands over the complete tree in one callback; CoreBluetooth needs
  one `discoverCharacteristics` round trip per service. Both platforms finish the whole tree
  before reporting `ready`, so `discoverServices` is a cached read on either.
- Connection timeouts: CoreBluetooth never times out, Android does after ~30 s with status 133.
  JavaScript owns one 15 s timeout for both (ADR 0005). Cancelling a pending attempt has no
  guaranteed callback on either platform, so native settles cancellations itself.
- GATT operations: neither stack accepts a second read or write before the first is answered
  (CoreBluetooth misorders the callbacks, `BluetoothGatt` returns `false` and drops the call),
  so both platforms serialize them in a per-connection `GattOperationQueue` (ADR 0006).
- Write without response: CoreBluetooth delivers no callback for `.withoutResponse`, so iOS
  completes when the data is handed to the stack; Android still calls `onCharacteristicWrite`
  for `WRITE_TYPE_NO_RESPONSE`, confirming local transmission only. The promise means the same
  thing on both: the stack accepted the write.
- Android's read and write callbacks changed shape in API 33 (`onCharacteristicRead` gained a
  `value` parameter, `writeCharacteristic(characteristic, value, writeType)` replaced setting
  the value on the characteristic); `DeviceConnection` uses the new overloads on 33+ and the
  deprecated ones below.
- Bytes: `Data` on iOS, a signed `ByteArray` on the JVM; both cross the bridge as `number[]`
  in `0..255`.
- Subscribing: CoreBluetooth's `setNotifyValue(_:for:)` writes the Client Characteristic
  Configuration descriptor itself and answers through `didUpdateNotificationStateFor`;
  Android's `setCharacteristicNotification` only routes callbacks locally, so
  `DeviceConnection` writes the descriptor (`0x2902`) explicitly and waits for
  `onDescriptorWrite`. Both go through the GATT queue and the promise means the same thing on
  both: the peripheral acknowledged the change (ADR 0007).
- Notification or indication: iOS decides inside `setNotifyValue`; Android encodes the choice
  in the descriptor value (`NotificationDescriptorMapper`: notification when `notify` is
  offered, indication only when `indicate` is offered alone). Both stacks acknowledge
  indications themselves; the app sees one `characteristic.value_changed` either way.
- Value delivery: CoreBluetooth reports read results and notifications through the same
  `didUpdateValueFor`, told apart by whether a read is pending for that characteristic;
  Android has a dedicated `onCharacteristicChanged`, which gained a `value` parameter in API
  33 like the read callback. Both stamp the value natively before emitting it.
- Subscriptions end with the link on both platforms without a per-characteristic callback
  (CoreBluetooth forgets `isNotifying`, Android's descriptor state dies with the closed
  client), so JavaScript drops them when the connection leaves `ready` rather than asking.
- Sharing a file: iOS presents `UIActivityViewController` and its completion handler
  distinguishes a completed activity from a dismissal, so `false` means dismissed. Android
  starts `Intent.createChooser`, which finishes as soon as a target is picked; the target runs
  in its own task and almost none report a result, so Android resolves `true` once the sheet
  is presented and never reports a dismissal. The UI says a file "was handed to the share
  sheet" on both, because that is all either can prove (ADR 0010).
- Where the shared file lives: iOS shares a file URL from `<tmp>/beacon-exports` directly.
  Android has no shareable file paths, so the file goes out as a `content://` URI from a
  `FileProvider` scoped to `<cacheDir>/beacon-exports`, with a read grant on both the send
  intent and the chooser. Both platforms refuse a path they did not write.

## Monorepo mechanics

- yarn 1 workspaces hoist dependencies to the repo root.
- Metro watches the repo root and resolves from both `apps/mobile/node_modules` and the root.
- Gradle resolves `react-native`, `@react-native/codegen`, `hermes-compiler` (the prebuilt
  Hermes compiler used for release bundles) and the RN Gradle plugin through Node
  (`require.resolve`) instead of hard-coded `../node_modules` paths.
- The Podfile already resolves `react_native_pods.rb` through Node.
- One root `tsconfig.json`, `eslint.config.js`, `babel.config.js`, and a Jest `projects` config
  cover every workspace.
