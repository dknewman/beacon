import { BLE_PERMISSION_STATES } from '@beacon/ble-contracts';
import { describePermissionState } from '../permissionLabels';

describe('describePermissionState', () => {
  it.each(BLE_PERMISSION_STATES)('provides non-empty text for %s', state => {
    const label = describePermissionState(state);
    expect(label.short.length).toBeGreaterThan(0);
    expect(label.description.length).toBeGreaterThan(0);
  });

  it('uses distinct short labels', () => {
    const shorts = BLE_PERMISSION_STATES.map(
      state => describePermissionState(state).short,
    );
    expect(new Set(shorts).size).toBe(shorts.length);
  });
});
