import { describeProperties, labelCharacteristic, labelService } from '../gattLabels';

describe('gattLabels', () => {
  it('names known services and characteristics with their short code', () => {
    expect(
      labelService({
        uuid: '0000181D-0000-1000-8000-00805F9B34FB',
        primary: true,
        characteristics: [],
      }),
    ).toEqual({ code: '181D', title: 'Weight Scale', known: true });
    expect(
      labelCharacteristic({
        serviceUuid: '0000181D-0000-1000-8000-00805F9B34FB',
        uuid: '00002A9D-0000-1000-8000-00805F9B34FB',
        properties: ['indicate'],
      }),
    ).toEqual({ code: '2A9D', title: 'Weight Measurement', known: true });
  });

  it('gives unknown entries a placeholder title that says what they are', () => {
    expect(
      labelService({
        uuid: '0000FFF0-0000-1000-8000-00805F9B34FB',
        primary: false,
        characteristics: [],
      }),
    ).toEqual({ code: 'FFF0', title: 'Unknown secondary service', known: false });
    expect(
      labelCharacteristic({
        serviceUuid: '0000FFF0-0000-1000-8000-00805F9B34FB',
        uuid: '12345678-1234-1234-1234-123456789ABC',
        properties: [],
      }),
    ).toEqual({
      code: '12345678-1234-1234-1234-123456789ABC',
      title: 'Unknown characteristic',
      known: false,
    });
  });

  it('describes properties in contract order with readable names', () => {
    expect(describeProperties(['read', 'write_without_response', 'indicate'])).toBe(
      'Read, Write without response, Indicate',
    );
    expect(describeProperties([])).toBe('None');
  });
});
