# Security and Privacy

Beacon is a developer utility that reads and writes to nearby Bluetooth devices, some of which
carry health data. These are the standing rules (PROJECT.md 35) and how the code upholds them.

## Rules

- Never perform destructive writes automatically. Every write requires a deliberate user action
  that shows the target characteristic and the outgoing bytes before sending.
- Do not upload BLE data. Beacon has no network backend; `NSAllowsArbitraryLoads` remains false.
- Export only after explicit user action, through the platform share sheet. Nothing exports
  itself: an export happens when someone presses Export JSON or Export CSV on a session, one
  at a time, and a session that is still recording cannot be exported at all. The document is
  written to a private directory the export module owns and handed to the share sheet; where
  it goes from there is the person's choice, and the app is not told.
- Sanitize logs. Developer mode may show raw bytes on screen, but nothing is written to system
  logs in release builds; the `no-console` lint rule is an error.
- Avoid storing sensitive health data unnecessarily. Sessions are recorded only while the user
  has started one and are stored locally in SQLite (M8); deleting a session deletes its packets.
  An export copies a session into the app's temporary or cache directory, which is not backed
  up and which the OS may reclaim; `clearTemporaryFiles` empties it on request, but nothing
  calls it on a schedule yet (ADR 0010).

## Export (M9)

An export leaves the app, so the rules around it are stated rather than assumed.

- Only files the export module itself wrote are ever shared. `shareFile` checks containment
  before anything is presented: iOS standardises and symlink-resolves both paths and compares
  path components, so a `..` in the middle cannot walk out of the directory and back in and a
  sibling directory whose name merely starts with ours does not pass; Android compares
  canonical paths and requires the file to be a direct child of the store's directory. A path
  that fails either check is refused with `export_file_missing`. A file name from JavaScript is
  reduced to its last path component before it is used, and one that reduces to nothing usable
  is refused, so a caller names a file and does not choose where it lands.
- Android shares through a `FileProvider` with authority `${applicationId}.exports`, declared
  `android:exported="false"` with `android:grantUriPermissions="true"` and scoped by
  `res/xml/export_paths.xml` to the single `beacon-exports` cache subdirectory. The rest of the
  cache holds the JavaScript bundle, images and the database's working files, and none of it is
  reachable through a share. The read grant is set on both the `ACTION_SEND` intent and the
  chooser and is what the containment check exists to bound: the chooser hands the app the
  person picks read access to the URI it is given.
- The app is never told where a shared file went. iOS can say the sheet was dismissed; Android
  cannot say anything beyond "the sheet was presented", so the UI says a file "was handed to
  the share sheet" and never that it was delivered.
- Both native file stores keep their own subdirectory rather than the temporary or cache
  directory itself, so clearing exports can never remove something another part of the app
  left there.

## Permissions posture

- iOS: Bluetooth only; no location, no background modes (see PERMISSIONS.md).
- Android: `BLUETOOTH_SCAN` is declared `neverForLocation` so the OS does not treat scans as
  location access; fine location is requested only on API 30 and below where the platform
  requires it for scan results.

## Boundary validation

Every payload from native is validated against zod schemas before it enters application state.
Byte arrays are checked for range; UUIDs are canonicalized; unknown event types are rejected.
This limits the blast radius of a misbehaving peripheral or a native bug.

## Threat model notes

- Peripherals are untrusted. Parsed values are presentation only and are never used to drive
  automatic writes.
- Device identifiers on iOS are app-scoped UUIDs; on Android they are MAC addresses. Exports
  include them by design (they are needed to reproduce a session), along with every recorded
  value: the JSON document is full fidelity and the CSV carries the bytes as hex. The export
  controls say so — "Exports include the device identifier and every recorded value." — next
  to the buttons, before anything is shared.
- An exported CSV opens in a spreadsheet, so a value that arrived over the air must not be able
  to run there. Every field goes through RFC 4180 quoting, and one beginning with a character a
  spreadsheet would treat as a formula (`=`, `+`, `-`, `@`, tab or carriage return) is prefixed
  with a quote.
- Signing: the repository ships only the Android debug keystore from the RN template. Release
  signing is a deployment concern outside this repository.

## Assumptions to revisit

- Bonding/pairing UI is a stretch goal; until then, characteristics requiring encryption will
  fail with a mapped error rather than prompting.
- No secrets are stored; if that changes, use the platform keychain/keystore, never SQLite.
