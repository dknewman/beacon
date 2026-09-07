import {
  bytesToAscii,
  bytesToBinary,
  bytesToDecimal,
  bytesToHex,
  bytesToUtf8,
  isByteArray,
  parseByteInput,
  parseDecimalInput,
  parseHexInput,
  parseUtf8Input,
  utf8ToBytes,
} from '../bytes';

describe('byte rendering', () => {
  const sample = [0x02, 0x9a, 0x1c, 0x00, 0x00];

  it('renders the PROJECT.md packet example in every column', () => {
    expect(bytesToHex(sample)).toBe('02 9A 1C 00 00');
    expect(bytesToHex(sample, '')).toBe('029A1C0000');
    expect(bytesToDecimal(sample)).toBe('2 154 28 0 0');
    expect(bytesToBinary([0x02, 0x9a])).toBe('00000010 10011010');
    expect(bytesToAscii(sample)).toBe('.....');
    expect(bytesToAscii([0x48, 0x69, 0x21, 0x7f])).toBe('Hi!.');
  });

  it('decodes UTF-8 only when valid', () => {
    expect(bytesToUtf8([0x50, 0x6f, 0x6c, 0x61, 0x72])).toBe('Polar');
    expect(bytesToUtf8([0xc3, 0xa9])).toBe('é');
    expect(bytesToUtf8([0xe2, 0x82, 0xac])).toBe('€');
    expect(bytesToUtf8([0xf0, 0x9f, 0x94, 0xb5])).toBe('🔵');
    expect(bytesToUtf8([])).toBe('');
    // invalid lead, truncated sequence, bad continuation, overlong, surrogate, above U+10FFFF
    expect(bytesToUtf8([0xff, 0xfe])).toBeUndefined();
    expect(bytesToUtf8([0xc3])).toBeUndefined();
    expect(bytesToUtf8([0xe2, 0x82])).toBeUndefined();
    expect(bytesToUtf8([0xc3, 0x41])).toBeUndefined();
    expect(bytesToUtf8([0xc0, 0x80])).toBeUndefined();
    expect(bytesToUtf8([0xe0, 0x80, 0x80])).toBeUndefined();
    expect(bytesToUtf8([0xed, 0xa0, 0x80])).toBeUndefined();
    expect(bytesToUtf8([0xf4, 0x90, 0x80, 0x80])).toBeUndefined();
  });

  it('round-trips UTF-8 through the encoder', () => {
    for (const text of ['', 'Hi', 'é', '€', '🔵 Beacon', 'ü€🔵a']) {
      expect(bytesToUtf8(utf8ToBytes(text))).toBe(text);
    }
    expect(utf8ToBytes('€')).toEqual([0xe2, 0x82, 0xac]);
    expect(utf8ToBytes('🔵')).toEqual([0xf0, 0x9f, 0x94, 0xb5]);
    expect(utf8ToBytes('\ud83d')).toEqual([0xef, 0xbf, 0xbd]);
  });

  it('guards byte arrays', () => {
    expect(isByteArray([0, 255])).toBe(true);
    expect(isByteArray([256])).toBe(false);
    expect(isByteArray([1.5])).toBe(false);
    expect(isByteArray('01')).toBe(false);
  });
});

describe('byte parsing', () => {
  it('accepts hex in the forms people actually type', () => {
    for (const input of [
      '02 9A 1C',
      '029a1c',
      '02:9a:1c',
      '0x02 0x9A 0x1C',
      '02-9A-1C',
      ' 02 9A 1C ',
    ]) {
      expect(parseHexInput(input)).toEqual({ ok: true, bytes: [0x02, 0x9a, 0x1c] });
    }
    expect(parseHexInput('')).toEqual({ ok: true, bytes: [] });
  });

  it('rejects invalid hex with a message that names the problem', () => {
    expect(parseHexInput('02 9G')).toEqual({
      ok: false,
      message: '"G" is not a hex digit.',
    });
    expect(parseHexInput('029')).toEqual({
      ok: false,
      message: 'Hex input needs an even number of digits (two per byte).',
    });
  });

  it('accepts decimal bytes and rejects out-of-range values', () => {
    expect(parseDecimalInput('2 154 28 0 0')).toEqual({
      ok: true,
      bytes: [2, 154, 28, 0, 0],
    });
    expect(parseDecimalInput('2,154,28')).toEqual({ ok: true, bytes: [2, 154, 28] });
    expect(parseDecimalInput('')).toEqual({ ok: true, bytes: [] });
    expect(parseDecimalInput('256')).toEqual({
      ok: false,
      message: '256 is above 255; each value is one byte.',
    });
    expect(parseDecimalInput('1.5')).toEqual({
      ok: false,
      message: '"1.5" is not a whole number.',
    });
    expect(parseDecimalInput('-1')).toEqual({
      ok: false,
      message: '"-1" is not a whole number.',
    });
  });

  it('encodes UTF-8 text', () => {
    expect(parseUtf8Input('Hi')).toEqual({ ok: true, bytes: [0x48, 0x69] });
    expect(parseUtf8Input('é')).toEqual({ ok: true, bytes: [0xc3, 0xa9] });
    expect(parseByteInput('utf8', '')).toEqual({ ok: true, bytes: [] });
  });

  it('dispatches by mode', () => {
    expect(parseByteInput('hex', 'FF')).toEqual({ ok: true, bytes: [255] });
    expect(parseByteInput('decimal', '255')).toEqual({ ok: true, bytes: [255] });
  });
});
