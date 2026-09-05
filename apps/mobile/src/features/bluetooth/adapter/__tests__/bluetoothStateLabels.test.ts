import { BLUETOOTH_STATES } from '@beacon/ble-contracts';
import { describeBluetoothState } from '../bluetoothStateLabels';

describe('describeBluetoothState', () => {
  it.each(BLUETOOTH_STATES)('provides non-empty text for %s', state => {
    const label = describeBluetoothState(state);
    expect(label.short.length).toBeGreaterThan(0);
    expect(label.description.length).toBeGreaterThan(0);
  });

  it('uses distinct short labels so state is never ambiguous', () => {
    const shorts = BLUETOOTH_STATES.map(state => describeBluetoothState(state).short);
    expect(new Set(shorts).size).toBe(shorts.length);
  });
});
