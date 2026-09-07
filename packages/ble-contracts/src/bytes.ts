/* eslint-disable no-bitwise -- byte encoding is the one place bit operators belong */
/**
 * Byte encoding and parsing shared by the packet inspector, the write form and
 * the parsers (PROJECT.md 16, 18). Bytes are plain number arrays (0..255)
 * because that is what crosses the bridge; Uint8Array does not.
 */

export type ByteInputMode = 'hex' | 'decimal' | 'utf8';

export type ByteParseResult =
  { ok: true; bytes: number[] } | { ok: false; message: string };

export function isByteArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255,
    )
  );
}

/** "02 9A 1C" style, uppercase, one space between bytes; empty string for no bytes. */
export function bytesToHex(bytes: number[], separator = ' '): string {
  return bytes
    .map(byte => byte.toString(16).toUpperCase().padStart(2, '0'))
    .join(separator);
}

/** "2 154 28" style. */
export function bytesToDecimal(bytes: number[]): string {
  return bytes.map(byte => String(byte)).join(' ');
}

/** "00000010 10011010" style. */
export function bytesToBinary(bytes: number[]): string {
  return bytes.map(byte => byte.toString(2).padStart(8, '0')).join(' ');
}

/**
 * Printable ASCII with a dot for everything else, the classic hex-dump column.
 * Never throws and never hides bytes, unlike a UTF-8 decode.
 */
export function bytesToAscii(bytes: number[]): string {
  return bytes
    .map(byte => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'))
    .join('');
}

/**
 * Strict UTF-8 decode; undefined when the bytes are not valid UTF-8 (truncated
 * sequences, overlong encodings, surrogates, values above U+10FFFF).
 * Hand-rolled because Hermes ships no TextDecoder.
 */
export function bytesToUtf8(bytes: number[]): string | undefined {
  const codePoints: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index] as number;
    let needed: number;
    let codePoint: number;
    let minimum: number;
    if (lead < 0x80) {
      needed = 0;
      codePoint = lead;
      minimum = 0;
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1;
      codePoint = lead & 0x1f;
      minimum = 0x80;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      needed = 2;
      codePoint = lead & 0x0f;
      minimum = 0x800;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      needed = 3;
      codePoint = lead & 0x07;
      minimum = 0x10000;
    } else {
      return undefined;
    }
    if (index + needed >= bytes.length + (needed === 0 ? 1 : 0)) {
      return undefined;
    }
    for (let offset = 1; offset <= needed; offset += 1) {
      const continuation = bytes[index + offset] as number;
      if ((continuation & 0xc0) !== 0x80) {
        return undefined;
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    if (
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return undefined;
    }
    codePoints.push(codePoint);
    index += needed + 1;
  }
  return String.fromCodePoint(...codePoints);
}

/** UTF-8 encode; lone surrogates become U+FFFD, as TextEncoder does. */
export function utf8ToBytes(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    let codePoint = char.codePointAt(0) ?? 0xfffd;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

/**
 * Parses hex input as a user types it: "02 9A 1C", "029a1c", "02:9a:1c",
 * "0x02 0x9A" and "02-9A" are all accepted. Rejects odd digit counts and
 * anything that is not a hex digit or separator.
 */
export function parseHexInput(text: string): ByteParseResult {
  const cleaned = text
    .trim()
    .replace(/0x/gi, '')
    .replace(/[\s:,-]+/g, '');
  if (cleaned === '') {
    return { ok: true, bytes: [] };
  }
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    const offending = cleaned.match(/[^0-9a-fA-F]/)?.[0] ?? '?';
    return { ok: false, message: `"${offending}" is not a hex digit.` };
  }
  if (cleaned.length % 2 !== 0) {
    return {
      ok: false,
      message: 'Hex input needs an even number of digits (two per byte).',
    };
  }
  const bytes: number[] = [];
  for (let index = 0; index < cleaned.length; index += 2) {
    bytes.push(Number.parseInt(cleaned.slice(index, index + 2), 16));
  }
  return { ok: true, bytes };
}

/** Parses "2 154 28" or "2,154,28"; rejects values outside 0..255 and non-integers. */
export function parseDecimalInput(text: string): ByteParseResult {
  const tokens = text
    .trim()
    .split(/[\s,]+/)
    .filter(token => token !== '');
  const bytes: number[] = [];
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) {
      return { ok: false, message: `"${token}" is not a whole number.` };
    }
    const value = Number.parseInt(token, 10);
    if (value > 255) {
      return { ok: false, message: `${value} is above 255; each value is one byte.` };
    }
    bytes.push(value);
  }
  return { ok: true, bytes };
}

/** UTF-8 encodes text; always succeeds. */
export function parseUtf8Input(text: string): ByteParseResult {
  return { ok: true, bytes: utf8ToBytes(text) };
}

export function parseByteInput(mode: ByteInputMode, text: string): ByteParseResult {
  switch (mode) {
    case 'hex':
      return parseHexInput(text);
    case 'decimal':
      return parseDecimalInput(text);
    case 'utf8':
      return parseUtf8Input(text);
  }
}
