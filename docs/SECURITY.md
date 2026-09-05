# Security and Privacy

Beacon is a developer utility that reads and writes to nearby Bluetooth devices, some of which
carry health data. These are the standing rules (PROJECT.md 35) and how the code upholds them.

## Rules

- Never perform destructive writes automatically. Every write requires a deliberate user action
  that shows the target characteristic and the outgoing bytes before sending.
- Do not upload BLE data. Beacon has no network backend; `NSAllowsArbitraryLoads` remains false.
- Export only after explicit user action, through the platform share sheet.
- Sanitize logs. Developer mode may show raw bytes on screen, but nothing is written to system
  logs in release builds; the `no-console` lint rule is an error.
- Avoid storing sensitive health data unnecessarily. Sessions are recorded only while the user
  has started one and are stored locally in SQLite (M8); deleting a session deletes its packets.

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
  include them by design (they are needed to reproduce a session); the export UI will say so.
- Signing: the repository ships only the Android debug keystore from the RN template. Release
  signing is a deployment concern outside this repository.

## Assumptions to revisit

- Bonding/pairing UI is a stretch goal; until then, characteristics requiring encryption will
  fail with a mapped error rather than prompting.
- No secrets are stored; if that changes, use the platform keychain/keystore, never SQLite.
