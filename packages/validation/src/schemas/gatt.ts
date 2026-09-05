import { CHARACTERISTIC_PROPERTIES } from '@beacon/ble-contracts';
import { z } from 'zod';
import { uuidSchema } from './primitives';

export const characteristicPropertySchema = z.enum(CHARACTERISTIC_PROPERTIES);

export const gattCharacteristicSchema = z.object({
  serviceUuid: uuidSchema,
  uuid: uuidSchema,
  properties: z.array(characteristicPropertySchema),
});

export const gattServiceSchema = z.object({
  uuid: uuidSchema,
  primary: z.boolean(),
  characteristics: z.array(gattCharacteristicSchema),
});

export const gattServiceListSchema = z.array(gattServiceSchema);
