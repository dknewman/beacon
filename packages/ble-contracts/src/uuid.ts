/**
 * UUID normalization.
 *
 * Platforms disagree about UUID formatting:
 * - iOS CBUUID renders 16-bit SIG UUIDs as "180D" and 128-bit as uppercase.
 * - Android ParcelUuid always renders 128-bit lowercase.
 *
 * Beacon's canonical form is the full 128-bit, uppercase, hyphenated UUID.
 * Short SIG identifiers are expanded with the Bluetooth Base UUID
 * 0000XXXX-0000-1000-8000-00805F9B34FB.
 */
const BASE_UUID_SUFFIX = '-0000-1000-8000-00805F9B34FB';
const FULL_UUID_PATTERN =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const SHORT_UUID_PATTERN = /^[0-9A-F]{4}$/;
const MEDIUM_UUID_PATTERN = /^[0-9A-F]{8}$/;
const UNHYPHENATED_PATTERN = /^[0-9A-F]{32}$/;

export class InvalidUuidError extends Error {
  override readonly name = 'InvalidUuidError';
  constructor(readonly input: string) {
    super(`Invalid Bluetooth UUID: "${input}"`);
  }
}

/** Returns the canonical 128-bit uppercase form, or throws InvalidUuidError. */
export function normalizeUuid(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/^0X/, '');

  if (FULL_UUID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  if (SHORT_UUID_PATTERN.test(cleaned)) {
    return `0000${cleaned}${BASE_UUID_SUFFIX}`;
  }
  if (MEDIUM_UUID_PATTERN.test(cleaned)) {
    return `${cleaned}${BASE_UUID_SUFFIX}`;
  }
  if (UNHYPHENATED_PATTERN.test(cleaned)) {
    return [
      cleaned.slice(0, 8),
      cleaned.slice(8, 12),
      cleaned.slice(12, 16),
      cleaned.slice(16, 20),
      cleaned.slice(20, 32),
    ].join('-');
  }
  throw new InvalidUuidError(input);
}

export function isCanonicalUuid(value: string): boolean {
  return FULL_UUID_PATTERN.test(value);
}

/**
 * Returns the 16-bit SIG short form ("180D") when the UUID is derived from
 * the Bluetooth Base UUID, otherwise undefined.
 */
export function toShortUuid(canonical: string): string | undefined {
  if (!isCanonicalUuid(canonical) || !canonical.endsWith(BASE_UUID_SUFFIX)) {
    return undefined;
  }
  if (!canonical.startsWith('0000')) {
    return undefined;
  }
  return canonical.slice(4, 8);
}

/** Case-insensitive equality on the canonical form; never throws. */
export function uuidEquals(a: string, b: string): boolean {
  try {
    return normalizeUuid(a) === normalizeUuid(b);
  } catch {
    return false;
  }
}
