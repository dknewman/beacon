import {
  ByteReader,
  decodeSfloat,
  formatDateTime,
  round,
  sfloatDisplay,
} from '../reader';

describe('ByteReader', () => {
  it('reads little-endian scalars and tracks the offset', () => {
    const reader = new ByteReader(Uint8Array.from([0x2a, 0x34, 0x12, 0x01]));
    expect(reader.uint8('a')).toBe(0x2a);
    expect(reader.uint16('b')).toBe(0x1234);
    expect(reader.remaining).toBe(1);
    expect(() => reader.uint16('c')).toThrow(
      /Missing c: needed 2 byte\(s\) at offset 3, 1 left/,
    );
    expect(reader.uint8('d')).toBe(1);
    reader.expectEnd();
  });

  it('rejects trailing bytes for fixed-size values', () => {
    const reader = new ByteReader(Uint8Array.from([1, 2]));
    reader.uint8('a');
    expect(() => reader.expectEnd()).toThrow('1 unexpected trailing byte(s)');
  });

  it('reads the Date Time type and treats year 0 as unknown', () => {
    const known = new ByteReader(Uint8Array.from([0xea, 0x07, 9, 7, 10, 32, 14]));
    expect(formatDateTime(known.dateTime('t')!)).toBe('2026-09-07 10:32:14');
    const unknown = new ByteReader(Uint8Array.from([0, 0, 0, 0, 0, 0, 0]));
    expect(unknown.dateTime('t')).toBeUndefined();
    expect(unknown.remaining).toBe(0);
  });
});

describe('SFLOAT', () => {
  it('decodes mantissa and exponent as two 2s complement fields', () => {
    expect(decodeSfloat(0x0078)).toEqual({ kind: 'number', value: 120 });
    expect(decodeSfloat(0xf0a0)).toEqual({ kind: 'number', value: 16 });
    expect(decodeSfloat(0xf3e8)).toEqual({ kind: 'number', value: 100 });
    expect(decodeSfloat(0x0fff)).toEqual({ kind: 'number', value: -1 });
    expect(decodeSfloat(0x1005)).toEqual({ kind: 'number', value: 50 });
    expect(decodeSfloat(0xe123)).toEqual({ kind: 'number', value: 2.91 });
  });

  it('recognizes the special values', () => {
    expect(decodeSfloat(0x07ff)).toEqual({ kind: 'nan' });
    expect(decodeSfloat(0x0800)).toEqual({ kind: 'nres' });
    expect(decodeSfloat(0x07fe)).toEqual({ kind: 'positive_infinity' });
    expect(decodeSfloat(0x0802)).toEqual({ kind: 'negative_infinity' });
    expect(sfloatDisplay({ kind: 'nan' })).toBe('n/a');
    expect(sfloatDisplay({ kind: 'nres' })).toBe('n/a');
    expect(sfloatDisplay({ kind: 'positive_infinity' })).toBe('+∞');
    expect(sfloatDisplay({ kind: 'negative_infinity' })).toBe('−∞');
    expect(sfloatDisplay({ kind: 'number', value: 7.5 })).toBe(7.5);
  });

  it('rounds away float noise', () => {
    expect(round(14500 * 0.005, 3)).toBe(72.5);
    expect(round(0.1 + 0.2, 3)).toBe(0.3);
  });
});
