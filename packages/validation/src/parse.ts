import {
  BleError,
  type BleErrorCode,
  type BlePermissionState,
  type BluetoothState,
  type GattService,
  type NativeBleEvent,
} from '@beacon/ble-contracts';
import type { z } from 'zod';
import { fail, ok, type ValidationResult } from './result';
import { bluetoothStateSchema } from './schemas/bluetooth-state';
import { gattServiceListSchema } from './schemas/gatt';
import { byteArraySchema, rssiSchema } from './schemas/primitives';
import { nativeBleEventSchema } from './schemas/native-events';
import { blePermissionStateSchema } from './schemas/permissions';

/**
 * Runs a schema and converts failures into a BleError with code "invalid_payload".
 * The zod issue list is folded into the message so developer mode can show
 * exactly which field the native layer got wrong.
 */
export function validate<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  context: string,
  code: BleErrorCode = 'invalid_payload',
): ValidationResult<z.output<TSchema>, BleError> {
  const result = schema.safeParse(input);
  if (result.success) {
    // safeParse narrows to z.output<TSchema> on success; the explicit
    // generic call above keeps the output type attached for callers.
    return ok(result.data);
  }
  const details = result.error.issues
    .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  return fail(new BleError({ code, message: `${context}: ${details}` }));
}

export function parseBluetoothState(
  input: unknown,
): ValidationResult<BluetoothState, BleError> {
  return validate(bluetoothStateSchema, input, 'Invalid Bluetooth state from native');
}

export function parseBlePermissionState(
  input: unknown,
): ValidationResult<BlePermissionState, BleError> {
  return validate(
    blePermissionStateSchema,
    input,
    'Invalid permission state from native',
  );
}

export function parseNativeBleEvent(
  input: unknown,
): ValidationResult<NativeBleEvent, BleError> {
  return validate(nativeBleEventSchema, input, 'Invalid native BLE event');
}

export function parseRssi(input: unknown): ValidationResult<number, BleError> {
  return validate(rssiSchema, input, 'Invalid RSSI from native');
}

export function parseGattServices(
  input: unknown,
): ValidationResult<GattService[], BleError> {
  return validate(gattServiceListSchema, input, 'Invalid GATT services from native');
}

export function parseByteArray(input: unknown): ValidationResult<number[], BleError> {
  return validate(byteArraySchema, input, 'Invalid bytes from native');
}
