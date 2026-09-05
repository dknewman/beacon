import {
  BLUETOOTH_STATES,
  isBluetoothState,
  isBluetoothUsable,
} from '../bluetooth-state';

describe('isBluetoothState', () => {
  it.each(BLUETOOTH_STATES)('accepts %s', state => {
    expect(isBluetoothState(state)).toBe(true);
  });

  it('rejects platform-raw values and non-strings', () => {
    expect(isBluetoothState('poweredOn')).toBe(false);
    expect(isBluetoothState('STATE_ON')).toBe(false);
    expect(isBluetoothState(12)).toBe(false);
    expect(isBluetoothState(undefined)).toBe(false);
  });
});

describe('isBluetoothUsable', () => {
  it('is true only for powered_on', () => {
    expect(isBluetoothUsable('powered_on')).toBe(true);
    for (const state of BLUETOOTH_STATES.filter(s => s !== 'powered_on')) {
      expect(isBluetoothUsable(state)).toBe(false);
    }
  });
});
