import { parseGattServices } from '../parse';

describe('parseGattServices', () => {
  it('normalizes UUIDs in services and characteristics', () => {
    const result = parseGattServices([
      {
        uuid: '180d',
        primary: true,
        characteristics: [
          { serviceUuid: '180d', uuid: '2a37', properties: ['notify'] },
          { serviceUuid: '180d', uuid: '2A38', properties: ['read'] },
        ],
      },
      {
        uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
        primary: false,
        characteristics: [],
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          uuid: '0000180D-0000-1000-8000-00805F9B34FB',
          primary: true,
          characteristics: [
            {
              serviceUuid: '0000180D-0000-1000-8000-00805F9B34FB',
              uuid: '00002A37-0000-1000-8000-00805F9B34FB',
              properties: ['notify'],
            },
            {
              serviceUuid: '0000180D-0000-1000-8000-00805F9B34FB',
              uuid: '00002A38-0000-1000-8000-00805F9B34FB',
              properties: ['read'],
            },
          ],
        },
        {
          uuid: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
          primary: false,
          characteristics: [],
        },
      ],
    });
  });

  it('rejects unknown property names and malformed UUIDs with the failing path', () => {
    const badProperty = parseGattServices([
      {
        uuid: '180D',
        primary: true,
        characteristics: [
          { serviceUuid: '180D', uuid: '2A37', properties: ['PROPERTY_NOTIFY'] },
        ],
      },
    ]);
    expect(badProperty.ok).toBe(false);
    if (!badProperty.ok) {
      expect(badProperty.error.code).toBe('invalid_payload');
      expect(badProperty.error.message).toContain('0.characteristics.0.properties.0');
    }
    expect(
      parseGattServices([{ uuid: 'heart', primary: true, characteristics: [] }]).ok,
    ).toBe(false);
    expect(parseGattServices({}).ok).toBe(false);
  });

  it('accepts an empty table', () => {
    expect(parseGattServices([])).toEqual({ ok: true, value: [] });
  });
});
