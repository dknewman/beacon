import { BLE_ERROR_CODES } from '@beacon/ble-contracts';
import { z } from 'zod';

export const bleErrorCodeSchema = z.enum(BLE_ERROR_CODES);

export const bleErrorInfoSchema = z.object({
  code: bleErrorCodeSchema,
  message: z.string(),
  nativeCode: z.string().optional(),
  nativeDomain: z.string().optional(),
});
