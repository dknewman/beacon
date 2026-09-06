import { normalizeUuid, toShortUuid } from '@beacon/ble-contracts';
import type { CachedDevice } from './deviceCache';

/**
 * User-controlled list filters (PROJECT.md 10). Filtering happens in the
 * application layer on the full cache, so changing a filter never restarts the
 * native scan and clearing it brings hidden devices straight back.
 */
export interface DeviceFilters {
  /** Case-insensitive substring of the advertised or GAP name. */
  name: string;
  /** A full or partial service UUID; "180D" and "0000180d-…" match the same device. */
  serviceUuid: string;
  /** Hide devices weaker than this (dBm). Devices without RSSI are hidden when set. */
  minRssi?: number;
}

export const emptyDeviceFilters: DeviceFilters = { name: '', serviceUuid: '' };

/** RSSI thresholds offered by the filter bar, strongest last. */
export const RSSI_THRESHOLDS = [-80, -70, -60] as const;

export function isFiltering(filters: DeviceFilters): boolean {
  return (
    filters.name.trim() !== '' ||
    filters.serviceUuid.trim() !== '' ||
    filters.minRssi !== undefined
  );
}

export function applyDeviceFilters(
  devices: CachedDevice[],
  filters: DeviceFilters,
): CachedDevice[] {
  if (!isFiltering(filters)) {
    return devices;
  }
  const name = filters.name.trim().toLowerCase();
  const service = parseServiceFilter(filters.serviceUuid);
  return devices.filter(device => {
    if (name !== '' && !matchesName(device, name)) {
      return false;
    }
    if (service !== undefined && !matchesService(device, service)) {
      return false;
    }
    if (filters.minRssi !== undefined) {
      const rssi = device.smoothedRssi ?? device.rssi;
      if (rssi === undefined || rssi < filters.minRssi) {
        return false;
      }
    }
    return true;
  });
}

type ServiceFilter =
  { kind: 'exact'; uuid: string } | { kind: 'partial'; fragment: string };

function parseServiceFilter(input: string): ServiceFilter | undefined {
  const trimmed = input.trim();
  if (trimmed === '') {
    return undefined;
  }
  try {
    return { kind: 'exact', uuid: normalizeUuid(trimmed) };
  } catch {
    return { kind: 'partial', fragment: trimmed.toUpperCase() };
  }
}

function matchesName(device: CachedDevice, needle: string): boolean {
  return [device.name, device.localName].some(
    candidate => candidate !== undefined && candidate.toLowerCase().includes(needle),
  );
}

function matchesService(device: CachedDevice, filter: ServiceFilter): boolean {
  return device.serviceUuids.some(uuid =>
    filter.kind === 'exact'
      ? uuid === filter.uuid
      : uuid.includes(filter.fragment) ||
        (toShortUuid(uuid)?.includes(filter.fragment) ?? false),
  );
}
