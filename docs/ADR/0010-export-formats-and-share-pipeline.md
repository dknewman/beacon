# ADR 0010: Two export formats with different jobs; canonical key order for byte-stable JSON; a second Turbo Module for the file and the share sheet

Status: Accepted (M9)

## Context

M9 is the first milestone where anything leaves the device. PROJECT.md 21 asks for JSON and
CSV, says JSON "should preserve full fidelity" and CSV "should be human readable", and says to
use the native share sheets; PROJECT.md 35 adds the rule that binds all of it, "Export only
after explicit user action". M8 left the sessions where an export can find them: a
`SessionRepository` holding a `BleSession` and its ordered `SessionEvent`s (ADR 0009).
Six things had to be decided together:

1. what the two formats each owe the reader. "Full fidelity" and "human readable" are not two
   settings of one serializer: the first means nothing may be lost and the file must be
   readable by a program, the second means a person opens it in a spreadsheet and scans a
   column. A single format that tries to be both is worse at each;
2. what "full fidelity" is worth in practice. A file nothing can read back is a claim, not a
   property, and two exports of the same session that differ byte for byte cannot be
   diffed, checksummed or signed. JavaScript object key order is not semantically meaningful
   but it is what `JSON.stringify` writes, and the runtime schemas rebuild objects in their
   own declaration order, so a naive round trip reorders keys;
3. where writing a file and presenting a share sheet live. The app already has one Turbo
   Module, `BeaconBluetooth`, with a `BleErrorCode` union that means "something about the
   radio went wrong". Neither the file work nor the share sheet is a Bluetooth operation;
4. what stops a path from JavaScript turning a share into a way to hand out arbitrary files
   from the app container. On Android the share grants the chosen app read access to whatever
   URI it is given, so this is a real permission decision, not a tidiness one;
5. what the completion boolean means. iOS and Android can answer "did the person share it" to
   genuinely different depths, and the UI has to say something true on both;
6. when an export may run. A session that is still recording is a moving target, and two
   share sheets cannot be presented at once.

## Decision

### Two formats in one package, each with one job

`packages/session-export` (`@beacon/session-export`) holds both serializers, depends only on
`@beacon/ble-contracts` and `@beacon/validation`, and imports nothing from the app or from
React, like the parser package before it (ADR 0008).

`toJsonExport(session, events, options)` writes a versioned document — `version`, `generator`,
`exportedAt`, `session`, `events` — carrying every field the repository holds. `version` is
`JSON_EXPORT_VERSION`, currently 1, so a future reader can tell which shape it is looking at
without guessing from the contents; `generator` names the tool for someone opening the file
years later; `exportedAt` is when the export was taken, which is not when the session ran.
`parseJsonExport(text)` reads it back through `parseBleSession` and `parseSessionEvent`, the
same runtime schemas the repository validates its own rows with, so a hand-edited or
truncated file fails at the boundary with the field named rather than deeper in. Nothing else
in the app calls `parseJsonExport` yet; it exists because a fidelity claim that is never
exercised is not a fidelity claim, and the tests exercise it.

`toCsvExport(session, events, options)` writes the human-readable one: a
`field,value` summary block naming the session (id, device, start, end, counts), a blank line,
then the `sequence,timestamp,kind,service,characteristic,detail,bytes,byteCount` header and
one row per event. UUIDs are shortened to their 16-bit form where one exists (`180D`, `2A37`)
and kept in full when the peripheral uses a vendor UUID; bytes are hex with a count next to
them; the kinds that carry no bytes put their meaning in `detail` (a connection state, an
RSSI in dBm, discovery counts, "subscribed", an error message with its code) and leave the
byte columns empty rather than filling them with a zero that would sort as data. Rows are
terminated with CRLF, including the last, and every field goes through RFC 4180 quoting: a
comma, a quote or a newline wraps the field and doubles its quotes. A field starting with a
character a spreadsheet would treat as a formula (`=`, `+`, `-`, `@`, tab or carriage return)
is prefixed with a single quote, so a value that arrived over the air can never execute when
someone opens the file.

### Canonical key order, so the JSON is byte-stable

`canonical.ts` rebuilds a session and each event kind with their keys in a fixed order, and
both `buildSessionExport` and `parseJsonExport` run everything through it. Optional fields
that are absent are omitted rather than written as `null`, on both paths, so their absence
round trips too. The result is that two exports of the same session are the same file, and
re-exporting a parsed document reproduces its input byte for byte — which is what makes a
diff, a checksum or a signature over an export mean anything. The tests assert the round trip,
the byte-stability of re-export, and that a session handed over with its keys in a different
order still writes the same bytes.

### A second Turbo Module, and its own error codes

`BeaconExport` is a separate Turbo Native Module with three calls, and deliberately not part
of `BeaconBluetooth`:

- `writeTemporaryFile(fileName, contents)` writes the document as UTF-8 into a private
  directory the module owns and resolves with the absolute path;
- `shareFile(path, mimeType)` presents the platform share sheet for a file the module wrote;
- `clearTemporaryFiles()` empties that directory and resolves with how many files went.

Its failures are `ExportErrorCode` in `@beacon/session-export` — `export_write_failed`,
`export_share_failed`, `export_file_missing`, `export_source_failed`, `export_unknown` — and
are kept out of `BleErrorCode` for the same reason the module is separate: folding a full disk
and a missing view controller into the union that means "the radio, the link or a GATT
operation" would make that union mean two different things, and every exhaustive switch over
it would have to answer for cases it can never see. Native rejects with the wire code as the
promise's `code`, exactly as the BLE bridge does, and `createNativeExportClient` maps it back
with `toExportError`, defaulting an uncoded rejection per call site
(`export_write_failed`, `export_share_failed`). Three of the five codes are raised natively;
`export_source_failed` (the session or its events could not be read back) and
`export_unknown` are raised in JavaScript, so the Swift and Kotlin enums list only the three
they can produce rather than carrying dead cases.

### Only files the module itself wrote are ever shared

Both platforms answer "is this ours" themselves rather than trusting the path.
`ExportFileStore` on each side owns one named subdirectory — `<tmp>/beacon-exports` on iOS,
`<cacheDir>/beacon-exports` on Android — rather than the temporary or cache directory itself,
so a clear can never remove something another part of the app left there. A `fileName` from
JavaScript is reduced to its last path component before it is used, and a name that reduces to
nothing usable (empty, `.`, `..`) is refused, so a caller names a file and does not get to
choose where it lands. `shareFile` checks containment before anything is presented: iOS
standardises and symlink-resolves both sides and compares path components, so a `..` in the
middle cannot walk out and back in and a sibling directory whose name merely starts with ours
does not pass; Android compares canonical paths and requires the file to be a direct child of
the store's directory. Existence is checked separately from containment, because a path that
was never written and a path that has since been cleared are different bugs even though both
are refused with `export_file_missing`.

On Android the share is what makes this a permission decision rather than tidiness: the
chooser grants the app the person picks read access to the URI it is handed. The file goes out
through a `FileProvider` declared in the manifest with authority `${applicationId}.exports`,
`android:exported="false"` and `android:grantUriPermissions="true"`, and
`res/xml/export_paths.xml` scopes it to the one `beacon-exports` cache subdirectory — the rest
of the cache holds the JavaScript bundle, images and the database's working files, and none of
that should be reachable through a share. `FLAG_GRANT_READ_URI_PERMISSION` is set on both the
`ACTION_SEND` intent and the chooser, because the grant travels with the intent that is
actually started. Both native stores are pure enough to unit test — no UIKit in
`ExportFileStore.swift`, no Android framework types in `ExportFileStore.kt` — so the
containment rules are asserted in XCTest and JUnit rather than left to a device.

### The completion boolean says only what each platform can prove

iOS reports a dismissal accurately: `UIActivityViewController`'s
`completionWithItemsHandler` distinguishes a completed activity from a dismissal, so `false`
there means the sheet was closed without sharing.

Android always resolves `true` once the chooser has been started. `Intent.createChooser`
finishes as soon as a target is picked; the target then runs in its own task, and almost none
of them report a result. Wiring an `ActivityEventListener` and `startActivityForResult` is
easy enough, and it would report "cancelled" for most successful shares — answering wrongly is
worse than not answering, so Android answers only the part it knows: the sheet was presented.

The contract therefore reads `false` as "definitely dismissed" and `true` as "not known to be
dismissed", never as proof the document went anywhere, and the UI says so in the words it
uses: a completed share is reported as "`<file>` was handed to the share sheet", not as
delivered. Android simply never produces the dismissed line.

### User-initiated, one at a time, and always the whole session

There is no automatic path into the export machine (PROJECT.md 35). `exportReducer.ts` is the
per-session state — `idle` with the previous `lastOutcome`, `preparing` while the document is
built and written, `sharing` while the sheet is open — and a request that arrives while
anything is in flight is ignored rather than queued, because two share sheets cannot be
presented at once and the person can press again when the sheet closes. `useSessionExport`
guards the same rule with a ref so a second press cannot slip through before the reducer has
re-rendered.

The events are read from the repository inside the hook, not taken from the screen, so the
document is always the whole session rather than the page the timeline happens to have loaded.
A session that is still recording cannot be exported at all: `SessionDetailScreen` disables
both buttons with "Stop the session before exporting it, so the file holds the whole
recording", because a file that holds part of a session is worse than no file. And because an
export carries the device identifier and every recorded value, `ExportControls` says so in a
note next to the buttons before anyone shares anything (docs/SECURITY.md).

## Alternatives considered

- One format instead of two. PROJECT.md 21 asks for both, and the reason holds up: a JSON
  document that a spreadsheet can open is not JSON, and a CSV that loses nothing is a CSV with
  a JSON blob in a cell. Two serializers of about a hundred lines each are cheaper than one
  that is bad at both jobs.
- Making the CSV lossless — every field of every event kind as its own column, or a JSON blob
  in a `payload` column. The first gives a table that is mostly empty, because the union has
  eight kinds with different fields, and it grows a column every time a kind does; the second
  gives a spreadsheet a cell nobody can read. CSV is the report, JSON is the record, and
  `toCsvExport` is free to flatten because the other format loses nothing.
- Putting `writeTemporaryFile` and `shareFile` on `BeaconBluetooth`. One fewer module to
  register on each platform, at the price of a BLE module that also does file IO and an error
  union that means two things. The registration cost is a line in `MainApplication` and an
  entry in `codegenConfig.ios.modulesProvider`.
- `react-native-share`. It does this job and more, and it is another native dependency to
  build, keep current and audit for a feature whose whole native surface is one directory, one
  containment check and one system controller — and it would not have made the honest-boolean
  decision above for us. Writing it means the containment rule is ours to state and to test.
- React Native's built-in `Share` API. It does not suffice: on iOS `Share.share` takes a
  `url`, which can be a file URL, but on Android it takes only `message` and `title` — there
  is no way to attach a file, so a CSV would have to be pasted into a text share. A module
  that works on one platform is not a cross-platform export.
- Streaming very large sessions to disk instead of building the document in memory. Correct
  for a session of a million events, and it would mean a chunked writer on the native side,
  an incremental JSON encoder, and paging `listEvents` — real machinery for a size no session
  has reached. The whole-document build is simple and testable; the limitation is recorded
  below and the repository already pages (`fromSequence`, `limit`) when this needs revisiting.
- Sharing the document as text rather than as a file. It skips the file store, the
  `FileProvider` and the containment check entirely, and it gives the person a wall of text in
  a message app instead of something with a name and an extension that a spreadsheet or a
  script can open. A session export is a document, and PROJECT.md 21 asks for share sheets
  because that is how a document leaves a phone.

## Consequences

- `App` takes an `exportClient` prop next to `bleClient` and `sessionRepository`.
  `ExportClientProvider` is the outermost provider, above `BleClientProvider`, because the
  export path is independent of the radio: it reads the repository and the platform, never the
  BLE client. Tests render `App` with `FakeExportClient`, which keeps the write and the share
  pending until the test settles them, the same way `FakeBleClient` does for native calls.
- There is no import yet. `parseJsonExport` reads a document back and the tests hold it to the
  round trip, but nothing in the app opens a file; a session that was exported and deleted is
  gone.
- The whole document is built in memory, twice over while it is written: the serialized string
  and the array it came from. A very long session — the hundreds of rows a second ADR 0009
  left uncapped — could make that large enough to matter on an old phone. There is no size
  limit and no warning yet.
- Android cannot report whether a share completed, so the "was closed without sharing" outcome
  only ever appears on iOS. Anything downstream that wants a per-platform accurate answer will
  have to get it from somewhere other than this boolean.
- Temporary files are cleared only when something asks. `clearTemporaryFiles` exists on the
  client and is exercised by its tests, but nothing calls it on a schedule or at launch, so an
  export stays in the app's temporary or cache directory until the platform reclaims it. Both
  locations are ones the OS may clear on its own, and neither is backed up, which is why this
  is a wart rather than a leak.
- Exports carry raw bytes, not parsed readings. Parsing is stateless and derived at render
  time (ADR 0008), so nothing parsed is stored to export; a reader that wants "Heart rate,
  80 bpm" re-parses the bytes with the same registry.
- The iOS module compiles only in CI. `BeaconExportModule.mm` imports the same
  `BeaconBluetoothSpec` umbrella header the BLE module does, because every spec in
  `codegenConfig.jsSrcsDir` lands there, which is a naming oddity to live with rather than a
  problem to solve.
- No share sheet has been presented on a device. `ShareSheetPresenter` needs a live window and
  `BeaconExportModule.shareFile` needs a foreground Activity, so neither is unit tested;
  both are validated by hand, and M9 has not had that (see the README milestone table).
