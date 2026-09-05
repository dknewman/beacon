import { isCanonicalUuid, normalizeUuid } from '@beacon/ble-contracts';
import { z } from 'zod';

/** An unsigned byte as sent across the bridge (JSON numbers, not Uint8Array). */
export const byteSchema = z.number().int().min(0).max(255);

export const byteArraySchema = z.array(byteSchema);

/**
 * Accepts any platform UUID formatting and transforms to Beacon's canonical
 * 128-bit uppercase form so the rest of the app can compare UUIDs by equality.
 */
export const uuidSchema = z.string().transform((value, ctx) => {
  try {
    return normalizeUuid(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: `Invalid Bluetooth UUID: ${value}` });
    return z.NEVER;
  }
});

/** Strict variant for data that is already expected to be canonical (persisted rows). */
export const canonicalUuidSchema = z
  .string()
  .refine(isCanonicalUuid, { message: 'UUID must be canonical 128-bit uppercase form' });

/** ISO-8601 timestamps; native layers must format with millisecond precision. */
export const isoTimestampSchema = z.iso.datetime({ offset: true });

/** RSSI in dBm. Real-world range is roughly -120..0; the bounds catch sign bugs. */
export const rssiSchema = z.number().int().min(-200).max(20);

/** Uppercase hex with no separators, even length (manufacturer/service data). */
export const hexStringSchema = z
  .string()
  .regex(/^([0-9A-F]{2})*$/, { message: 'Expected uppercase hex bytes' });
