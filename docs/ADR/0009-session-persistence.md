# ADR 0009: Sessions in SQLite behind a repository boundary; one write path through an activity bus and a buffered recorder; explicit sessions

Status: Accepted (M8)

## Context

M8 is the first milestone that keeps anything after the process ends. PROJECT.md 20 asks for
sessions that record connection events, RSSI updates, service discovery, reads, writes,
notifications, errors and disconnects, with a timeline, statistics and a history; PROJECT.md 30
names SQLite, suggests `sessions` and `session_events` among the tables, and requires schema
migrations "from the beginning"; PROJECT.md 5 lists "Persisted JSON" among the data that must
pass a runtime schema. Five things had to be decided together:

1. where the rows live and how the application layer talks to them. Every earlier milestone
   kept its state in a reducer behind a provider; a database is the first dependency that is
   neither the bridge nor React, and the first one Jest cannot fake with a plain object
   without losing what matters, the SQL;
2. how the recorder learns what happened. The connection, GATT, packet and subscription
   coordinators each know one kind of activity, and the recorder needs all of them in one
   stream with the order they occurred in. The packet log (ADR 0006) holds only bytes, not
   connection transitions, RSSI readings, subscription changes or errors, and is a bounded
   ring buffer that forgets;
3. what a session is. A link can drop and be re-established while a person is watching a
   peripheral, and a notifying characteristic can deliver a hundred values a second while the
   session is open (ADR 0007);
4. how often the database is written. One transaction per event at 100 Hz is one hundred
   transactions a second on a phone; one transaction per session loses everything on a crash;
5. what happens when the app dies while recording, and what happens when a write fails.

## Decision

### A repository boundary with two implementations and one contract test

`features/sessions/SessionRepository.ts` is the storage boundary: `createSession`,
`appendEvents` (in order, assigning the next sequence numbers, atomic per call),
`endSession`, `getSession`, `listSessions` (newest first), `listEvents` (ascending sequence,
optionally paged by `fromSequence` and `limit`) and `deleteSession`. The recorder and the
screens see this interface and nothing else. `InMemorySessionRepository` is the reference
implementation and what `App` tests are rendered with; `SqliteSessionRepository` is what
the app ships. Both run the same contract suite (`sessionRepository.contract.ts`), so the
two cannot drift in what "newest first", "atomic per call" or `SessionNotFoundError` mean.

### SQLite through op-sqlite, behind a three-method interface

`storage/SqlDatabase.ts` is the whole SQL surface the repositories use: `execute(sql,
params)` returning rows of `string | number | null`, `transaction(work)` committing when the
work resolves and rolling back when it throws, and `close()`. `storage/openAppDatabase.ts`
is the only module that imports `@op-engineering/op-sqlite`; `createOpSqliteDatabase` binds
the library's connection to the interface and narrows row values (booleans to 0/1, blobs to
hex) so nothing library-shaped reaches the repository. The library was chosen because it is
a JSI binding with no bridge round trip per statement, supports the New Architecture the app
already requires, and autolinks on both platforms; the adapter is small enough that swapping
it is one file.

### Versioned migrations from the first release

`storage/migrations.ts` keeps `SCHEMA_MIGRATIONS`, an append-only list of `{ version,
description, statements }`. `migrate` reads `PRAGMA user_version`, applies every migration
above it in order, each in its own transaction that ends by setting `user_version`, and
rejects duplicate versions. A migration that fails midway is rolled back and leaves the
version where it was, so the next launch retries from a known schema rather than from half
of one. Version 1 creates `sessions` (`id`, `device_id`, `device_name`, `started_at`,
`ended_at`, `packet_count`, `event_count`, indexed by `started_at DESC`) and
`session_events` (`session_id` referencing `sessions` with `ON DELETE CASCADE`, `sequence`,
`timestamp`, `kind`, `payload`, primary key `(session_id, sequence)`).
`prepareSessionDatabase` turns `PRAGMA foreign_keys` on, which SQLite leaves off per
connection, before migrating.

### One JSON payload per event, validated on the way back

An event is stored as its `kind`, its `timestamp` and the whole `SessionEventInput` as JSON in
`payload`; `kind` and `timestamp` are columns so the timeline can be listed and filtered
without parsing, and everything else stays one document per row. Reading back goes through
`parseBleSession` and `parseSessionEventInput` (`@beacon/validation`, the same zod schemas
that type the contract), so a row from an older build, a hand-edited database or a corrupt
write surfaces as a validation failure: the row is reported through `onInvalidRow` and
skipped, and the screen shows the rest of the session rather than crashing on one row.
`packet_count` and `event_count` are kept on the session row and updated in the same
transaction as the append, so the history list needs no `COUNT(*)` per row.

### sql.js runs the same SQL under Jest

`tests/fakes/SqlJsDatabase.ts` implements `SqlDatabase` over `sql.js`, SQLite compiled to
WebAssembly, in process, with no native module. The migration tests and the SQLite repository
tests run the real statements against a real SQLite engine: `PRAGMA user_version`,
`PRAGMA table_info`, the cascade, a duplicate primary key aborting a batch. The fake is a dev
dependency at the repo root and never ships; the device uses op-sqlite. What the fake cannot
cover is the op-sqlite binding itself, which has its own tests against a hand-written
connection and is otherwise a native build that CI compiles.

### The activity bus is the single write path

`features/activity/activityBus.ts` is an in-process publish/subscribe of `DeviceActivity`,
`{ deviceId } & SessionEventInput`: synchronous fan-out, no history, a listener that throws
does not stop the others. `ActivityBusProvider` sits directly under `BleClientProvider` so
every coordinator publishes to the same bus: `ConnectionProvider` publishes every
`connection.state_changed` transition, every device-scoped error including the ones
JavaScript raises itself (the 15 s connect timeout, a failed request) and every RSSI reading;
`GattProvider` publishes `services_discovered` with the service and characteristic counts;
`SubscriptionProvider` publishes a `subscription` event when the peripheral acknowledges a
change and one `notification` per value at flush time, carrying the native timestamp;
`useCharacteristicOperations` publishes a successful `read` and `write`. Failures of a read,
write or subscription stay where ADR 0006 and 0007 put them (the operation outcome, the
subscription entry) and are not published; the link-level `ble.error` is. The recorder is
the bus's only subscriber today; the M9 export reads the repository, not the bus.

### Explicit sessions, captured from the start request

A session begins when a person presses Start and ends when they press Stop
(`SessionRecorderProvider`, the Session Manager of PROJECT.md 20). It is not tied to the link:
a peripheral that drops and reconnects while a session is open produces `connection`
events inside one session, which is the timeline a person debugging a flaky link wants.
Capture begins at the start request, before the row exists: events published while
`createSession` is in flight wait in the device's buffer and are appended once the id is
known, so the `connecting → ready` transitions a person starts recording for are not lost
to the database's latency. A start that fails returns the device to `idle` with the message
and discards the buffer.

### Buffered, serialized appends; a failed batch is counted, not fatal

Published events are appended to a per-device ref buffer, which touches no React state, and
written with one `appendEvents` call, one transaction, every 250 ms
(`DEFAULT_SESSION_FLUSH_INTERVAL_MS`) or as soon as 200 events are buffered
(`DEFAULT_MAX_BUFFERED_EVENTS`), whichever comes first. Four writes a second keeps a 100 Hz
stream to a few dozen rows per transaction and a Stop feels immediate. Store operations for
one device run strictly one after another through a promise chain, so sequence numbers match
the order things happened even when a slow append overlaps the next flush. A rejected
append drops that batch, adds its size to `droppedCount`, keeps `lastError`, and leaves the
session open; the next batch tries again, so a transient failure costs a gap rather than the
recording. Stop flushes what is buffered first, then ends the row; a late acknowledgement
while `stopping` still counts.

### Sessions left open by a crash are closed on the next launch

`recoverOpenSessions` runs when the recorder mounts: every session without `endedAt` is
ended at its newest event's timestamp, or at its start when nothing was recorded, so the
history never shows a session as running when nothing is writing to it. The events already
appended are kept; only the buffer that was in flight when the process died is gone, which
is at most one flush interval.

### The database opens lazily

`bootstrap.tsx` wraps the SQLite repository in `createLazySessionRepository`: the database is
opened and migrated on the first repository call, not at launch, so the composition root
stays synchronous like the rest of the app and a database that cannot be opened surfaces as
a failed Start with its message rather than a crash before the first screen. A failed open
is retried on the next call. Sessions are real even with the mock radio, so the mock
environment records like hardware would.

## Alternatives considered

- AsyncStorage or MMKV: key-value stores, fine for the preferences PROJECT.md 5 assigns them
  to, and wrong for a timeline: a session of ten thousand events would be one value
  rewritten on every append, or ten thousand keys with no ordering or range query. PROJECT.md
  30 names SQLite for sessions and packets for that reason.
- Realm or WatermelonDB: each brings its own schema language, migration runner and query
  layer, and each would replace the runtime schemas the project already validates with;
  neither runs under Jest without more machinery than sql.js. SQL with a three-method
  interface is what the repository needs, and the migration runner is forty lines.
- Recording from the packet log instead of a bus: the log holds bytes only, is a 500-entry
  ring buffer that forgets, and would need to be polled or diffed to learn what changed;
  connection transitions, RSSI, subscriptions and errors would still need another path. One
  bus every coordinator publishes to gives the recorder every kind in one stream at the
  moment it happened.
- Auto-starting a session on connect and stopping it on disconnect: fewer taps, and a link
  that drops and comes back would split into two sessions at exactly the moment the person
  wants one timeline. Explicit Start and Stop match PROJECT.md 20 and make a session mean
  what the person asked for.
- One table per event kind: queryable columns, at the price of eight tables, eight insert
  paths and a `UNION` to list a timeline; every new kind would be a migration. One events
  table with a typed `kind` column and a validated JSON payload keeps the timeline one query
  and a new kind one schema variant.
- One transaction per event: simplest, and a hundred transactions a second while a heart
  rate strap streams RR intervals. One transaction per session: fast, and a crash loses
  everything. A 250 ms batch bounds both.
- Opening the database at launch: an open failure would abort the app before the first
  screen; opening on first use keeps the app usable as an inspector when the store is broken.
- Recording notifications one by one as they arrive rather than at the 100 ms flush: the
  notification's timestamp is native (ADR 0007), so publishing at flush time changes nothing
  in the recorded time and keeps the bus quiet at one publish per value per flush.

## Consequences

- `App` takes a `sessionRepository` prop next to `bleClient`; tests render it with
  `InMemorySessionRepository` and drive the recorder through the fake client, the same way
  they drive everything else without mocking modules.
- Provider order gains two entries: `ActivityBusProvider` directly under the client, above
  every publisher, and `SessionRecorderProvider` below every publisher and above navigation.
  A coordinator that publishes must sit between them.
- `@op-engineering/op-sqlite` is a native dependency on both platforms (autolinked; iOS needs
  `pod install` after pulling). CI compiles it in the Android and iOS jobs; whether it opens
  and writes on a device is hardware validation, which M8 has not had.
- There is no cap on a session's size yet: a session left recording against a 100 Hz stream
  grows by a few hundred rows a second until Stop. A limit, and what to do when it is
  reached, is deferred.
- A failed append loses that batch (up to 250 ms or 200 events) and reports the count; the
  session stays open. There is no retry of the same batch and no dead-letter buffer.
- JSON payloads are not queryable by column: a question like "every notification on
  characteristic `2A37` across sessions" is a scan and a parse, not an index. `kind` and
  `timestamp` are the only columns of an event besides its key, and the only index on
  `session_events` is the primary key `(session_id, sequence)`.
- Export (M9) is out of scope: sessions can be reviewed and deleted in the app and nothing
  leaves the device yet.
- The recorder's `revision` bumps whenever the set of stored sessions changes (start, stop,
  recovery, delete), so the history list refetches without polling the database.
- Invalid rows are skipped silently in the app; `onInvalidRow` exists so a diagnostics
  channel can report them when one is added.
