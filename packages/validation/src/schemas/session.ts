import { CONNECTION_STATES } from '@beacon/ble-contracts';
import { z } from 'zod';
import { bleErrorInfoSchema } from './errors';
import {
  byteArraySchema,
  canonicalUuidSchema,
  isoTimestampSchema,
  rssiSchema,
} from './primitives';

/** Persisted session rows; the shape stored and read back from SQLite. */
export const bleSessionSchema = z.object({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1).optional(),
  startedAt: isoTimestampSchema,
  endedAt: isoTimestampSchema.optional(),
  packetCount: z.number().int().min(0),
  eventCount: z.number().int().min(0),
});

const characteristicRef = {
  serviceUuid: canonicalUuidSchema,
  characteristicUuid: canonicalUuidSchema,
};

/** Persisted JSON of one event, validated on the way back in (PROJECT.md "Persisted JSON"). */
export const sessionEventInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('connection'),
    timestamp: isoTimestampSchema,
    state: z.enum(CONNECTION_STATES),
  }),
  z.object({ kind: z.literal('rssi'), timestamp: isoTimestampSchema, rssi: rssiSchema }),
  z.object({
    kind: z.literal('services_discovered'),
    timestamp: isoTimestampSchema,
    serviceCount: z.number().int().min(0),
    characteristicCount: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('subscription'),
    timestamp: isoTimestampSchema,
    ...characteristicRef,
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.literal('read'),
    timestamp: isoTimestampSchema,
    ...characteristicRef,
    bytes: byteArraySchema,
  }),
  z.object({
    kind: z.literal('write'),
    timestamp: isoTimestampSchema,
    ...characteristicRef,
    bytes: byteArraySchema,
  }),
  z.object({
    kind: z.literal('notification'),
    timestamp: isoTimestampSchema,
    ...characteristicRef,
    bytes: byteArraySchema,
  }),
  z.object({
    kind: z.literal('error'),
    timestamp: isoTimestampSchema,
    error: bleErrorInfoSchema,
  }),
]);

export const sessionEventSchema = z.intersection(
  sessionEventInputSchema,
  z.object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    sequence: z.number().int().min(1),
  }),
);
