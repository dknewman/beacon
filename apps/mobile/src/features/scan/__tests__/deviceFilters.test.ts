import type { CachedDevice } from '../deviceCache';
import {
  applyDeviceFilters,
  emptyDeviceFilters,
  isFiltering,
  RSSI_THRESHOLDS,
} from '../deviceFilters';

function device(overrides: Partial<CachedDevice> & { id: string }): CachedDevice {
  return {
    serviceUuids: [],
    lastSeenAt: '2026-09-06T12:00:00.000Z',
    firstSeenAt: '2026-09-06T12:00:00.000Z',
    advertisementCount: 1,
    ...overrides,
  };
}

const HEART_RATE = '0000180D-0000-1000-8000-00805F9B34FB';
const CUSTOM = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';

const devices = [
  device({
    id: 'hrm',
    name: 'Polar H10',
    rssi: -55,
    smoothedRssi: -55,
    serviceUuids: [HEART_RATE],
  }),
  device({ id: 'scale', localName: 'QN-Scale', rssi: -75, smoothedRssi: -75 }),
  device({ id: 'nordic', rssi: -90, smoothedRssi: -90, serviceUuids: [CUSTOM] }),
  device({ id: 'silent' }),
];

const ids = (result: CachedDevice[]) => result.map(d => d.id);

describe('applyDeviceFilters', () => {
  it('returns everything when no filter is set', () => {
    expect(isFiltering(emptyDeviceFilters)).toBe(false);
    expect(applyDeviceFilters(devices, emptyDeviceFilters)).toBe(devices);
  });

  it('matches the name filter against name and local name, case-insensitively', () => {
    expect(
      ids(applyDeviceFilters(devices, { ...emptyDeviceFilters, name: 'polar' })),
    ).toEqual(['hrm']);
    expect(
      ids(applyDeviceFilters(devices, { ...emptyDeviceFilters, name: 'SCALE' })),
    ).toEqual(['scale']);
    expect(
      applyDeviceFilters(devices, { ...emptyDeviceFilters, name: 'nordic' }),
    ).toEqual([]);
  });

  it('matches short, long and lowercase service UUIDs exactly', () => {
    for (const input of [
      '180D',
      '180d',
      '0000180d-0000-1000-8000-00805f9b34fb',
      ' 0x180D ',
    ]) {
      expect(
        ids(applyDeviceFilters(devices, { ...emptyDeviceFilters, serviceUuid: input })),
      ).toEqual(['hrm']);
    }
  });

  it('matches partial UUID fragments while the user is still typing', () => {
    expect(
      ids(applyDeviceFilters(devices, { ...emptyDeviceFilters, serviceUuid: '18' })),
    ).toEqual(['hrm']);
    expect(
      ids(applyDeviceFilters(devices, { ...emptyDeviceFilters, serviceUuid: '6e4000' })),
    ).toEqual(['nordic']);
  });

  it('applies the RSSI threshold to the smoothed value and hides silent devices', () => {
    expect(RSSI_THRESHOLDS).toEqual([-80, -70, -60]);
    expect(
      ids(applyDeviceFilters(devices, { ...emptyDeviceFilters, minRssi: -80 })),
    ).toEqual(['hrm', 'scale']);
    expect(
      ids(applyDeviceFilters(devices, { ...emptyDeviceFilters, minRssi: -60 })),
    ).toEqual(['hrm']);
  });

  it('combines filters with AND semantics', () => {
    expect(
      applyDeviceFilters(devices, { name: 'polar', serviceUuid: '180D', minRssi: -50 }),
    ).toEqual([]);
    expect(
      ids(
        applyDeviceFilters(devices, { name: 'polar', serviceUuid: '180D', minRssi: -60 }),
      ),
    ).toEqual(['hrm']);
  });
});
