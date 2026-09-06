import type { BleDevice } from '@beacon/ble-contracts';
import {
  emptyDeviceCache,
  isStale,
  selectDevices,
  upsertDevice,
  type DeviceCache,
} from '../deviceCache';

const T0 = Date.parse('2026-09-06T12:00:00.000Z');
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function advertisement(overrides: Partial<BleDevice> & { id: string }): BleDevice {
  return { serviceUuids: [], lastSeenAt: at(0), ...overrides };
}

function ids(cache: DeviceCache, now = T0, staleAfterMs = 10_000): string[] {
  return selectDevices(cache, { now, staleAfterMs }).map(device => device.id);
}

describe('deviceCache', () => {
  it('adds a first sighting with bookkeeping', () => {
    const cache = upsertDevice(emptyDeviceCache, advertisement({ id: 'a', rssi: -50 }));
    expect(cache.byId.a).toEqual({
      id: 'a',
      rssi: -50,
      smoothedRssi: -50,
      serviceUuids: [],
      lastSeenAt: at(0),
      firstSeenAt: at(0),
      advertisementCount: 1,
    });
  });

  it('deduplicates by id and keeps the count', () => {
    let cache = upsertDevice(emptyDeviceCache, advertisement({ id: 'a', rssi: -50 }));
    cache = upsertDevice(
      cache,
      advertisement({ id: 'a', rssi: -60, lastSeenAt: at(500) }),
    );
    cache = upsertDevice(
      cache,
      advertisement({ id: 'a', rssi: -60, lastSeenAt: at(900) }),
    );
    expect(Object.keys(cache.byId)).toEqual(['a']);
    expect(cache.byId.a?.advertisementCount).toBe(3);
    expect(cache.byId.a?.rssi).toBe(-60);
    expect(cache.byId.a?.lastSeenAt).toBe(at(900));
    expect(cache.byId.a?.firstSeenAt).toBe(at(0));
  });

  it('only ever gains information across advertisements', () => {
    let cache = upsertDevice(
      emptyDeviceCache,
      advertisement({ id: 'a', serviceUuids: ['A'], manufacturerData: '0D00' }),
    );
    cache = upsertDevice(
      cache,
      advertisement({
        id: 'a',
        name: 'QN Scale',
        serviceUuids: ['B'],
        lastSeenAt: at(100),
      }),
    );
    cache = upsertDevice(
      cache,
      advertisement({ id: 'a', rssi: -70, lastSeenAt: at(200) }),
    );
    expect(cache.byId.a).toMatchObject({
      name: 'QN Scale',
      manufacturerData: '0D00',
      serviceUuids: ['B', 'A'],
      rssi: -70,
    });
  });

  it('smooths RSSI instead of jumping to every sample', () => {
    let cache = upsertDevice(emptyDeviceCache, advertisement({ id: 'a', rssi: -50 }));
    cache = upsertDevice(cache, advertisement({ id: 'a', rssi: -90, lastSeenAt: at(1) }));
    expect(cache.byId.a?.rssi).toBe(-90);
    expect(cache.byId.a?.smoothedRssi).toBeCloseTo(-62);
  });

  it('sorts strongest first, ties by first sighting, devices without RSSI last', () => {
    let cache = emptyDeviceCache;
    cache = upsertDevice(
      cache,
      advertisement({ id: 'weak', rssi: -85, lastSeenAt: at(0) }),
    );
    cache = upsertDevice(cache, advertisement({ id: 'silent', lastSeenAt: at(1) }));
    cache = upsertDevice(
      cache,
      advertisement({ id: 'strong', rssi: -40, lastSeenAt: at(2) }),
    );
    cache = upsertDevice(
      cache,
      advertisement({ id: 'mid-late', rssi: -61, lastSeenAt: at(3) }),
    );
    cache = upsertDevice(
      cache,
      advertisement({ id: 'mid-early', rssi: -59, lastSeenAt: at(1) }),
    );
    expect(ids(cache, T0 + 10)).toEqual([
      'strong',
      'mid-early',
      'mid-late',
      'weak',
      'silent',
    ]);
  });

  it('does not reorder rows on small RSSI wobble', () => {
    let cache = emptyDeviceCache;
    cache = upsertDevice(cache, advertisement({ id: 'first', rssi: -60 }));
    cache = upsertDevice(
      cache,
      advertisement({ id: 'second', rssi: -60, lastSeenAt: at(1) }),
    );
    cache = upsertDevice(
      cache,
      advertisement({ id: 'first', rssi: -63, lastSeenAt: at(2) }),
    );
    cache = upsertDevice(
      cache,
      advertisement({ id: 'second', rssi: -58, lastSeenAt: at(3) }),
    );
    expect(ids(cache, T0 + 10)).toEqual(['first', 'second']);
  });

  it('hides devices not seen within the stale window but keeps them cached', () => {
    let cache = upsertDevice(
      emptyDeviceCache,
      advertisement({ id: 'old', lastSeenAt: at(0) }),
    );
    cache = upsertDevice(cache, advertisement({ id: 'fresh', lastSeenAt: at(9_000) }));
    const selection = { now: T0 + 12_000, staleAfterMs: 10_000 };
    expect(selectDevices(cache, selection).map(d => d.id)).toEqual(['fresh']);
    expect(Object.keys(cache.byId)).toHaveLength(2);
    expect(isStale(cache.byId.old as never, selection)).toBe(true);
    // Seen again → visible again.
    cache = upsertDevice(cache, advertisement({ id: 'old', lastSeenAt: at(12_000) }));
    expect(selectDevices(cache, selection).map(d => d.id)).toEqual(['old', 'fresh']);
  });

  it('never mutates the previous cache', () => {
    const before = upsertDevice(emptyDeviceCache, advertisement({ id: 'a', rssi: -50 }));
    const snapshot = JSON.stringify(before);
    upsertDevice(before, advertisement({ id: 'a', rssi: -40, lastSeenAt: at(1) }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
