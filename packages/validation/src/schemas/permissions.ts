import { BLE_PERMISSION_STATES } from '@beacon/ble-contracts';
import { z } from 'zod';

export const blePermissionStateSchema = z.enum(BLE_PERMISSION_STATES);
