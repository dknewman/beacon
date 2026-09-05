import { CONNECTION_STATES } from '@beacon/ble-contracts';
import { z } from 'zod';
import { bluetoothStateSchema } from './bluetooth-state';
import { bleDeviceSchema } from './device';
import { bleErrorInfoSchema } from './errors';
import { byteArraySchema, isoTimestampSchema, uuidSchema } from './primitives';

export const connectionStateSchema = z.enum(CONNECTION_STATES);

export const bluetoothStateChangedEventSchema = z.object({
  type: z.literal('bluetooth.state_changed'),
  state: bluetoothStateSchema,
});

export const scanDeviceDiscoveredEventSchema = z.object({
  type: z.literal('scan.device_discovered'),
  device: bleDeviceSchema,
});

export const connectionStateChangedEventSchema = z.object({
  type: z.literal('connection.state_changed'),
  deviceId: z.string().min(1),
  state: connectionStateSchema,
});

export const characteristicValueChangedEventSchema = z.object({
  type: z.literal('characteristic.value_changed'),
  deviceId: z.string().min(1),
  serviceUuid: uuidSchema,
  characteristicUuid: uuidSchema,
  bytes: byteArraySchema,
  timestamp: isoTimestampSchema,
});

export const bleErrorEventSchema = z.object({
  type: z.literal('ble.error'),
  deviceId: z.string().min(1).optional(),
  error: bleErrorInfoSchema,
});

export const nativeBleEventSchema = z.discriminatedUnion('type', [
  bluetoothStateChangedEventSchema,
  scanDeviceDiscoveredEventSchema,
  connectionStateChangedEventSchema,
  characteristicValueChangedEventSchema,
  bleErrorEventSchema,
]);
