import {
  InvalidUuidError,
  isCanonicalUuid,
  normalizeUuid,
  toShortUuid,
  uuidEquals,
} from '../uuid';

describe('normalizeUuid', () => {
  it('expands 16-bit SIG UUIDs with the Bluetooth base UUID', () => {
    expect(normalizeUuid('180D')).toBe('0000180D-0000-1000-8000-00805F9B34FB');
    expect(normalizeUuid('180d')).toBe('0000180D-0000-1000-8000-00805F9B34FB');
    expect(normalizeUuid('0x180D')).toBe('0000180D-0000-1000-8000-00805F9B34FB');
  });

  it('expands 32-bit UUIDs', () => {
    expect(normalizeUuid('0000180F')).toBe('0000180F-0000-1000-8000-00805F9B34FB');
  });

  it('uppercases Android-style lowercase 128-bit UUIDs', () => {
    expect(normalizeUuid('6e400001-b5a3-f393-e0a9-e50e24dcca9e')).toBe(
      '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
    );
  });

  it('hyphenates unhyphenated 128-bit UUIDs', () => {
    expect(normalizeUuid('6e400001b5a3f393e0a9e50e24dcca9e')).toBe(
      '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUuid('  2A37 ')).toBe('00002A37-0000-1000-8000-00805F9B34FB');
  });

  it.each(['', '18', '180', 'ZZZZ', '180D-', 'not a uuid', '0000180D-0000-1000-8000'])(
    'rejects malformed input %p',
    input => {
      expect(() => normalizeUuid(input)).toThrow(InvalidUuidError);
    },
  );
});

describe('toShortUuid', () => {
  it('returns the 16-bit form for base-UUID derived values', () => {
    expect(toShortUuid('0000180D-0000-1000-8000-00805F9B34FB')).toBe('180D');
  });

  it('returns undefined for vendor UUIDs', () => {
    expect(toShortUuid('6E400001-B5A3-F393-E0A9-E50E24DCCA9E')).toBeUndefined();
  });

  it('returns undefined for 32-bit values that are not 16-bit assignable', () => {
    expect(toShortUuid('1234180D-0000-1000-8000-00805F9B34FB')).toBeUndefined();
  });

  it('returns undefined for non-canonical input', () => {
    expect(toShortUuid('180D')).toBeUndefined();
  });
});

describe('isCanonicalUuid', () => {
  it('accepts only uppercase hyphenated 128-bit form', () => {
    expect(isCanonicalUuid('0000180D-0000-1000-8000-00805F9B34FB')).toBe(true);
    expect(isCanonicalUuid('0000180d-0000-1000-8000-00805f9b34fb')).toBe(false);
    expect(isCanonicalUuid('180D')).toBe(false);
  });
});

describe('uuidEquals', () => {
  it('compares across formats', () => {
    expect(uuidEquals('180d', '0000180D-0000-1000-8000-00805F9B34FB')).toBe(true);
    expect(uuidEquals('180D', '180F')).toBe(false);
  });

  it('never throws on malformed input', () => {
    expect(uuidEquals('garbage', '180D')).toBe(false);
  });
});
