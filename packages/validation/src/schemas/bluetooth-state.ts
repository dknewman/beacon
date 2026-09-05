import { BLUETOOTH_STATES } from '@beacon/ble-contracts';
import { z } from 'zod';

export const bluetoothStateSchema = z.enum(BLUETOOTH_STATES);
