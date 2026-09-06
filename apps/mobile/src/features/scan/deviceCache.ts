import type { BleDevice } from '@beacon/ble-contracts';

/**
 * A device as held by the cache: the latest advertisement merged over earlier
 * ones, plus bookkeeping the list needs (first sighting, smoothed RSSI, count).
 */
export interface CachedDevice extends BleDevice {
  firstSeenAt: string;
  /** Exponential moving average of RSSI; absent until an advertisement carried one. */
  smoothedRssi?: number;
  advertisementCount: number;
}

/** Immutable map of devices keyed by platform id. Plain object so React can diff it. */
export interface DeviceCache {
  readonly byId: Readonly<Record<string, CachedDevice>>;
}

export const emptyDeviceCache: DeviceCache = { byId: {} };

/** Weight of the newest sample in the RSSI moving average. */
const RSSI_SMOOTHING = 0.3;

/**
 * Merges one validated advertisement into the cache.
 *
 * Deduplication is by `id`. Fields that a later advertisement omits are kept
 * from earlier ones (scan responses often carry the name while the main packet
 * carries the service list), so a row only ever gains information.
 */
export function upsertDevice(cache: DeviceCache, device: BleDevice): DeviceCache {
  const existing = cache.byId[device.id];
  const merged: CachedDevice =
    existing === undefined
      ? {
          ...device,
          firstSeenAt: device.lastSeenAt,
          advertisementCount: 1,
          ...(device.rssi === undefined ? {} : { smoothedRssi: device.rssi }),
        }
      : {
          ...existing,
          ...withoutUndefined(device),
          serviceUuids: unionPreservingOrder(device.serviceUuids, existing.serviceUuids),
          lastSeenAt: device.lastSeenAt,
          advertisementCount: existing.advertisementCount + 1,
          ...(device.rssi === undefined
            ? {}
            : { smoothedRssi: smooth(existing.smoothedRssi, device.rssi) }),
        };
  return { byId: { ...cache.byId, [device.id]: merged } };
}

export interface DeviceSelection {
  /** Reference time in epoch milliseconds (injected so tests and the ticker agree). */
  now: number;
  /** Devices not seen for longer than this are hidden, not deleted. */
  staleAfterMs: number;
}

/**
 * The visible, ordered device list.
 *
 * Ordering is by signal strength, strongest first, but on the smoothed RSSI
 * bucketed to 5 dBm so rows do not swap places on every advertisement. Ties
 * keep the order in which devices first appeared. Devices without RSSI sort last.
 */
export function selectDevices(
  cache: DeviceCache,
  selection: DeviceSelection,
): CachedDevice[] {
  const cutoff = selection.now - selection.staleAfterMs;
  return Object.values(cache.byId)
    .filter(device => Date.parse(device.lastSeenAt) >= cutoff)
    .sort(compareDevices);
}

export function isStale(device: CachedDevice, selection: DeviceSelection): boolean {
  return Date.parse(device.lastSeenAt) < selection.now - selection.staleAfterMs;
}

const RSSI_BUCKET_DB = 5;

function compareDevices(a: CachedDevice, b: CachedDevice): number {
  const byRssi = rssiBucket(b) - rssiBucket(a);
  if (byRssi !== 0) {
    return byRssi;
  }
  const byFirstSeen = Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt);
  if (byFirstSeen !== 0) {
    return byFirstSeen;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rssiBucket(device: CachedDevice): number {
  if (device.smoothedRssi === undefined) {
    return Number.NEGATIVE_INFINITY;
  }
  return Math.round(device.smoothedRssi / RSSI_BUCKET_DB);
}

function smooth(previous: number | undefined, sample: number): number {
  if (previous === undefined) {
    return sample;
  }
  return previous + RSSI_SMOOTHING * (sample - previous);
}

function unionPreservingOrder(first: string[], second: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of [...first, ...second]) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function withoutUndefined(device: BleDevice): Partial<BleDevice> {
  const result: Partial<BleDevice> = {};
  for (const [key, value] of Object.entries(device)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
