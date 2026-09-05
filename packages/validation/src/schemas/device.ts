import { z } from 'zod';
import {
  hexStringSchema,
  isoTimestampSchema,
  rssiSchema,
  uuidSchema,
} from './primitives';

export const bleDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  localName: z.string().optional(),
  rssi: rssiSchema.optional(),
  connectable: z.boolean().optional(),
  manufacturerData: hexStringSchema.optional(),
  serviceUuids: z.array(uuidSchema),
  lastSeenAt: isoTimestampSchema,
});
