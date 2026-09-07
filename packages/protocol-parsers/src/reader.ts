/**
 * Little-endian field reader over a characteristic value, with the Bluetooth
 * SIG scalar types the standard profiles use. Every read is bounds checked and
 * throws a ParseError naming the field, which the registry turns into a failed
 * outcome (and the raw fallback) rather than a crash.
 */
export class ParseError extends Error {
  override readonly name = 'ParseError';
}

export class ByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  uint8(field: string): number {
    this.require(1, field);
    const value = this.bytes[this.offset] as number;
    this.offset += 1;
    return value;
  }

  uint16(field: string): number {
    this.require(2, field);
    const low = this.bytes[this.offset] as number;
    const high = this.bytes[this.offset + 1] as number;
    this.offset += 2;
    return low + high * 256;
  }

  /** IEEE 11073-20601 16-bit SFLOAT: 12-bit mantissa and 4-bit exponent, both signed. */
  sfloat(field: string): SFloat {
    return decodeSfloat(this.uint16(field));
  }

  /** Bluetooth "Date Time" (7 bytes); undefined when the year is 0 (unknown). */
  dateTime(field: string): DateTime | undefined {
    const year = this.uint16(field);
    const month = this.uint8(field);
    const day = this.uint8(field);
    const hours = this.uint8(field);
    const minutes = this.uint8(field);
    const seconds = this.uint8(field);
    if (year === 0) {
      return undefined;
    }
    return { year, month, day, hours, minutes, seconds };
  }

  /** Fails unless every byte has been consumed; use for fixed-size values. */
  expectEnd(): void {
    if (this.remaining !== 0) {
      throw new ParseError(`${this.remaining} unexpected trailing byte(s)`);
    }
  }

  private require(count: number, field: string): void {
    if (this.remaining < count) {
      throw new ParseError(
        `Missing ${field}: needed ${count} byte(s) at offset ${this.offset}, ${this.remaining} left`,
      );
    }
  }
}

export interface DateTime {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** A decoded SFLOAT: a finite number, or one of the profile's special values. */
export type SFloat =
  | { kind: 'number'; value: number }
  | { kind: 'nan' }
  | { kind: 'nres' }
  | { kind: 'positive_infinity' }
  | { kind: 'negative_infinity' };

export function decodeSfloat(raw: number): SFloat {
  switch (raw) {
    case 0x07ff:
      return { kind: 'nan' };
    case 0x0800:
      return { kind: 'nres' };
    case 0x07fe:
      return { kind: 'positive_infinity' };
    case 0x0802:
      return { kind: 'negative_infinity' };
    default: {
      let mantissa = raw % 0x1000;
      if (mantissa >= 0x0800) {
        mantissa -= 0x1000;
      }
      let exponent = Math.floor(raw / 0x1000);
      if (exponent >= 0x08) {
        exponent -= 0x10;
      }
      const value =
        exponent >= 0 ? mantissa * 10 ** exponent : mantissa / 10 ** -exponent;
      return { kind: 'number', value };
    }
  }
}

/** "n/a" for the special values, so a field always has something to show. */
export function sfloatDisplay(value: SFloat): number | string {
  switch (value.kind) {
    case 'number':
      return value.value;
    case 'nan':
    case 'nres':
      return 'n/a';
    case 'positive_infinity':
      return '+∞';
    case 'negative_infinity':
      return '−∞';
  }
}

/** Trims float noise: 72.53500000001 → 72.535, 92 → 92. */
export function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

export function formatDateTime(value: DateTime): string {
  return `${pad(value.year, 4)}-${pad(value.month)}-${pad(value.day)} ${pad(value.hours)}:${pad(
    value.minutes,
  )}:${pad(value.seconds)}`;
}

/** Canonical form of a 16-bit SIG UUID, for matching a context's characteristic. */
export function sig(short: string): string {
  return `0000${short.toUpperCase()}-0000-1000-8000-00805F9B34FB`;
}
