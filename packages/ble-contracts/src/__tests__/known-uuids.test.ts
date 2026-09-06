import {
  describeCharacteristicUuid,
  describeServiceUuid,
  KNOWN_CHARACTERISTICS,
  KNOWN_SERVICES,
} from '../known-uuids';
import { normalizeUuid } from '../uuid';

describe('known UUID registry', () => {
  it('contains the PROJECT.md examples under their short keys', () => {
    expect(KNOWN_SERVICES['1800']).toBe('Generic Access');
    expect(KNOWN_SERVICES['1801']).toBe('Generic Attribute');
    expect(KNOWN_SERVICES['180D']).toBe('Heart Rate');
    expect(KNOWN_SERVICES['180F']).toBe('Battery Service');
    expect(KNOWN_SERVICES['1810']).toBe('Blood Pressure');
    expect(KNOWN_SERVICES['181D']).toBe('Weight Scale');
    expect(KNOWN_CHARACTERISTICS['2A9D']).toBe('Weight Measurement');
  });

  it('keys every SIG entry by its uppercase 16-bit form and vendor entries canonically', () => {
    for (const key of [
      ...Object.keys(KNOWN_SERVICES),
      ...Object.keys(KNOWN_CHARACTERISTICS),
    ]) {
      expect(key).toMatch(
        /^([0-9A-F]{4}|[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})$/,
      );
      expect(normalizeUuid(key)).toBeDefined();
    }
  });

  it('describes canonical UUIDs with the short display form and a name when known', () => {
    expect(describeServiceUuid(normalizeUuid('180D'))).toEqual({
      display: '180D',
      name: 'Heart Rate',
    });
    expect(describeCharacteristicUuid(normalizeUuid('2a37'))).toEqual({
      display: '2A37',
      name: 'Heart Rate Measurement',
    });
    expect(describeServiceUuid('6E400001-B5A3-F393-E0A9-E50E24DCCA9E')).toEqual({
      display: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
      name: 'Nordic UART Service',
    });
  });

  it('leaves unknown UUIDs unnamed but still displayable', () => {
    expect(describeServiceUuid(normalizeUuid('FFF0'))).toEqual({ display: 'FFF0' });
    expect(describeCharacteristicUuid('12345678-1234-1234-1234-123456789ABC')).toEqual({
      display: '12345678-1234-1234-1234-123456789ABC',
    });
  });

  it('does not confuse services with characteristics', () => {
    expect(describeServiceUuid(normalizeUuid('2A37')).name).toBeUndefined();
    expect(describeCharacteristicUuid(normalizeUuid('180D')).name).toBeUndefined();
  });
});
