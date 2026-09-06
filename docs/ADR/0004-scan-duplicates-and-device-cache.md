# ADR 0004: Request duplicate advertisements, throttle natively, deduplicate in the device cache

Status: Accepted (M2)

## Context

PROJECT.md 10 requires the device list to deduplicate devices, update RSSI, show "last seen",
sort intelligently and hide stale devices. The platforms disagree about what a scan callback
delivers:

- iOS reports each peripheral **once per scan** unless `CBCentralManagerScanOptionAllowDuplicatesKey`
  is set, in which case it reports every advertisement (often 10+ per second per peripheral).
- Android reports every advertisement by default (`CALLBACK_TYPE_ALL_MATCHES`) and additionally
  limits an app to five scan starts per 30 seconds.

Without duplicates there are no RSSI updates and no "last seen" clock; with raw duplicates the
bridge and the React tree would be flooded.

## Decision

1. The scan coordinator always requests `allowDuplicates: true`.
2. Native throttles to at most one discovery event per peripheral per 300 ms (`BluetoothManager`
   on iOS, `BleScanner` on Android). This is the only rate limiting in the system and it happens
   before serialization.
3. The application-layer device cache (`features/scan/deviceCache.ts`) is the single place that
   deduplicates by platform id, merges advertisement fields so a row only gains information,
   keeps an exponential moving average of RSSI (weight 0.3), and records first/last sighting.
4. The visible list is a projection: devices unseen for `staleAfterMs` (10 s) are hidden but not
   deleted, so they reappear without a new "first seen"; ordering uses the smoothed RSSI bucketed
   to 5 dBm with first-seen as tie breaker, so rows do not swap on every packet.
5. Filters (name, service UUID, minimum RSSI) apply in memory to the cache and never restart the
   native scan. Android's scan-start quota makes "filter = restart" a real hazard.
6. A native scanner failure arrives as `ble.error` with code `scan_failed` and no `deviceId`. The
   scan coordinator owns that code; the adapter machine ignores it. Every other device-less error
   still belongs to the adapter.

## Alternatives considered

- Native-side filtering by service UUID via `ScanFilter` / `withServices`: kept available on the
  bridge (`ScanOptions.serviceUuids`) for later features such as saved-device reconnection, but
  not used by the interactive filter because of the restart cost and the iOS behaviour of hiding
  peripherals that only advertise the service in a scan response.
- Deduplicating natively and sending only changes: would move product policy (what counts as a
  change, how to smooth) into two native codebases that must then agree.
- Deleting stale devices from the cache: loses `firstSeenAt` and advertisement counts that the
  session recorder (M8) and RSSI monitor (M22) want.

## Consequences

- Duplicate scanning costs battery on iOS. Scans are foreground-only and user-initiated; a
  background scanning mode would need to revisit this.
- The 300 ms throttle bounds bridge traffic at roughly 3 events per second per peripheral;
  a crowded room with 50 advertisers yields at most ~150 events per second, well within Turbo
  Module capacity. The cache update is O(1) per event and the list projection O(n log n) per tick.
- The coordinator, not the UI, decides when scanning may start (readiness must be `ready`) and
  stops the scan when readiness is lost, so the native layer never scans while the UI says idle.
