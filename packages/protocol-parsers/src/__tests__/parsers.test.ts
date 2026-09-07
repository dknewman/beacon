import type { ParserContext } from '@beacon/ble-contracts';
import { batteryLevelParser } from '../parsers/batteryLevel';
import { bloodPressureMeasurementParser } from '../parsers/bloodPressureMeasurement';
import { heartRateMeasurementParser } from '../parsers/heartRateMeasurement';
import { rawBytesParser } from '../parsers/rawBytes';
import { utf8TextParser } from '../parsers/utf8Text';
import { weightMeasurementParser } from '../parsers/weightMeasurement';
import { sig } from '../reader';

const context = (service: string, characteristic: string): ParserContext => ({
  serviceUuid: sig(service),
  characteristicUuid: sig(characteristic),
});
const bytes = (...values: number[]) => Uint8Array.from(values);

describe('batteryLevelParser', () => {
  const ctx = context('180F', '2A19');
  it('matches only the Battery Level characteristic', () => {
    expect(batteryLevelParser.matches(ctx)).toBe(true);
    expect(batteryLevelParser.matches(context('180D', '2A37'))).toBe(false);
  });
  it('parses the percentage', () => {
    expect(batteryLevelParser.parse(bytes(0x5c), ctx)).toEqual({
      parserId: 'battery-level',
      label: 'Battery level',
      summary: '92 %',
      fields: [{ name: 'Battery level', value: 92, unit: '%' }],
    });
  });
  it('rejects empty, oversized and out-of-range values', () => {
    expect(() => batteryLevelParser.parse(bytes(), ctx)).toThrow(/Missing battery level/);
    expect(() => batteryLevelParser.parse(bytes(50, 1), ctx)).toThrow(/trailing/);
    expect(() => batteryLevelParser.parse(bytes(101), ctx)).toThrow(/above 100/);
  });
});

describe('heartRateMeasurementParser', () => {
  const ctx = context('180D', '2A37');
  it('parses the 8-bit form with no optional fields', () => {
    expect(heartRateMeasurementParser.parse(bytes(0x00, 72), ctx)).toEqual({
      parserId: 'heart-rate-measurement',
      label: 'Heart rate',
      summary: '72 bpm',
      fields: [{ name: 'Heart rate', value: 72, unit: 'bpm' }],
    });
  });
  it('parses the 16-bit form', () => {
    expect(heartRateMeasurementParser.parse(bytes(0x01, 0x2c, 0x01), ctx).summary).toBe(
      '300 bpm',
    );
  });
  it('reports sensor contact, energy expended and RR intervals', () => {
    const value = heartRateMeasurementParser.parse(
      bytes(0x1e, 80, 0x10, 0x00, 0x4a, 0x03, 0x30, 0x03),
      ctx,
    );
    expect(value.fields).toEqual([
      { name: 'Heart rate', value: 80, unit: 'bpm' },
      { name: 'Sensor contact', value: 'Detected' },
      { name: 'Energy expended', value: 16, unit: 'kJ' },
      { name: 'RR intervals', value: '822.3, 796.9', unit: 'ms' },
    ]);
    expect(heartRateMeasurementParser.parse(bytes(0x04, 60), ctx).fields[1]).toEqual({
      name: 'Sensor contact',
      value: 'Not detected',
    });
  });
  it('fails on a truncated 16-bit rate', () => {
    expect(() => heartRateMeasurementParser.parse(bytes(0x01, 0x2c), ctx)).toThrow(
      /Missing heart rate/,
    );
  });
});

describe('weightMeasurementParser', () => {
  const ctx = context('181D', '2A9D');
  it('parses SI weight in 5 g units', () => {
    expect(weightMeasurementParser.parse(bytes(0x00, 0xa4, 0x38), ctx)).toEqual({
      parserId: 'weight-measurement',
      label: 'Weight',
      summary: '72.5 kg',
      fields: [{ name: 'Weight', value: 72.5, unit: 'kg' }],
    });
  });
  it('parses imperial weight in 0.01 lb units', () => {
    expect(weightMeasurementParser.parse(bytes(0x01, 0xa6, 0x47), ctx).summary).toBe(
      '183.42 lb',
    );
  });
  it('reads the optional timestamp, user and BMI with height', () => {
    const value = weightMeasurementParser.parse(
      bytes(0x0e, 0xa4, 0x38, 0xea, 0x07, 9, 7, 10, 32, 14, 3, 0xe6, 0x00, 0xf4, 0x06),
      ctx,
    );
    expect(value.fields).toEqual([
      { name: 'Weight', value: 72.5, unit: 'kg' },
      { name: 'Measured at', value: '2026-09-07 10:32:14' },
      { name: 'User', value: 3 },
      { name: 'BMI', value: 23 },
      { name: 'Height', value: 1.78, unit: 'm' },
    ]);
    const imperial = weightMeasurementParser.parse(
      bytes(0x0d, 0xa6, 0x47, 0xff, 0xe6, 0x00, 0xbe, 0x02),
      ctx,
    );
    expect(imperial.fields).toEqual([
      { name: 'Weight', value: 183.42, unit: 'lb' },
      { name: 'User', value: 'Unknown' },
      { name: 'BMI', value: 23 },
      { name: 'Height', value: 70.2, unit: 'in' },
    ]);
  });
  it('reports an unsuccessful measurement and short packets', () => {
    expect(() => weightMeasurementParser.parse(bytes(0x00, 0xff, 0xff), ctx)).toThrow(
      /unsuccessful/,
    );
    expect(() => weightMeasurementParser.parse(bytes(0x02, 0xa4, 0x38), ctx)).toThrow(
      /Missing timestamp/,
    );
  });
});

describe('bloodPressureMeasurementParser', () => {
  const ctx = context('1810', '2A35');
  it('parses mmHg pressures', () => {
    expect(
      bloodPressureMeasurementParser.parse(
        bytes(0x00, 0x78, 0x00, 0x50, 0x00, 0x5d, 0x00),
        ctx,
      ),
    ).toEqual({
      parserId: 'blood-pressure-measurement',
      label: 'Blood pressure',
      summary: '120/80 mmHg',
      fields: [
        { name: 'Systolic', value: 120, unit: 'mmHg' },
        { name: 'Diastolic', value: 80, unit: 'mmHg' },
        { name: 'Mean arterial pressure', value: 93, unit: 'mmHg' },
      ],
    });
  });
  it('parses kPa with a negative exponent and the optional fields', () => {
    const value = bloodPressureMeasurementParser.parse(
      bytes(
        0x1f,
        0xa0,
        0xf0, // 16.0 kPa
        0x6b,
        0xf0, // 10.7 kPa
        0x7f,
        0xf0, // 12.7 kPa
        0xea,
        0x07,
        9,
        7,
        10,
        32,
        14,
        0x48,
        0x00, // pulse 72
        0x01,
        0x05,
        0x00, // body movement + irregular pulse
      ),
      ctx,
    );
    expect(value.summary).toBe('16/10.7 kPa');
    expect(value.fields).toEqual([
      { name: 'Systolic', value: 16, unit: 'kPa' },
      { name: 'Diastolic', value: 10.7, unit: 'kPa' },
      { name: 'Mean arterial pressure', value: 12.7, unit: 'kPa' },
      { name: 'Measured at', value: '2026-09-07 10:32:14' },
      { name: 'Pulse rate', value: 72, unit: 'bpm' },
      { name: 'User', value: 1 },
      { name: 'Status', value: 'body movement, irregular pulse' },
    ]);
  });
  it('shows special SFLOAT values as text and a clean status as OK', () => {
    const value = bloodPressureMeasurementParser.parse(
      bytes(0x10, 0xff, 0x07, 0x50, 0x00, 0x00, 0x08, 0x00, 0x00),
      ctx,
    );
    expect(value.summary).toBe('n/a/80 mmHg');
    expect(value.fields[2]).toEqual({
      name: 'Mean arterial pressure',
      value: 'n/a',
      unit: 'mmHg',
    });
    expect(value.fields[3]).toEqual({ name: 'Status', value: 'OK' });
  });
});

describe('utf8TextParser', () => {
  it('matches the string characteristics and labels them', () => {
    const name = context('1800', '2A00');
    expect(utf8TextParser.matches(name)).toBe(true);
    expect(utf8TextParser.matches(context('180F', '2A19'))).toBe(false);
    expect(utf8TextParser.parse(bytes(0x50, 0x6f, 0x6c, 0x61, 0x72), name)).toEqual({
      parserId: 'utf8-text',
      label: 'Device name',
      summary: 'Polar',
      fields: [{ name: 'Device name', value: 'Polar' }],
    });
    const uart: ParserContext = {
      serviceUuid: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
      characteristicUuid: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E',
    };
    expect(utf8TextParser.parse(bytes(0x74, 0x69, 0x63, 0x6b, 0x0a), uart)).toMatchObject(
      {
        label: 'UART TX',
        summary: 'tick',
        fields: [{ name: 'UART TX', value: 'tick\n' }],
      },
    );
    expect(utf8TextParser.parse(bytes(), name).summary).toBe('(empty)');
  });
  it('rejects invalid UTF-8', () => {
    expect(() =>
      utf8TextParser.parse(bytes(0xff, 0xfe), context('1800', '2A00')),
    ).toThrow('Not valid UTF-8');
  });
});

describe('rawBytesParser', () => {
  it('matches everything and never fails', () => {
    const ctx = context('FFF0', 'FFF1');
    expect(rawBytesParser.matches(ctx)).toBe(true);
    expect(rawBytesParser.parse(bytes(0x02, 0x9a, 0x1c, 0x00, 0x00), ctx)).toEqual({
      parserId: 'raw-bytes',
      label: 'Raw bytes',
      summary: '02 9A 1C 00 00',
      fields: [
        { name: 'Length', value: 5, unit: 'bytes' },
        { name: 'HEX', value: '02 9A 1C 00 00' },
        { name: 'ASCII', value: '.....' },
      ],
    });
    expect(rawBytesParser.parse(bytes(), ctx).summary).toBe('(empty)');
  });
});
