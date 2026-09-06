/**
 * Error model shared by TypeScript, Swift, and Kotlin.
 *
 * Native layers reject promises and emit "ble.error" events using these exact
 * code strings. Anything else that arrives from native is mapped to "unknown"
 * by the validation layer so application code only ever sees this union.
 */
export const BLE_ERROR_CODES = [
  'bluetooth_unsupported',
  'bluetooth_powered_off',
  'permission_denied',
  'scan_failed',
  'device_not_found',
  'connection_timeout',
  'connection_failed',
  'disconnected',
  'service_not_found',
  'characteristic_not_found',
  'read_failed',
  'write_failed',
  'subscription_failed',
  'invalid_payload',
  'native_failure',
  'unknown',
] as const;

export type BleErrorCode = (typeof BLE_ERROR_CODES)[number];

export function isBleErrorCode(value: unknown): value is BleErrorCode {
  return (
    typeof value === 'string' && (BLE_ERROR_CODES as readonly string[]).includes(value)
  );
}

export interface BleErrorInfo {
  code: BleErrorCode;
  message: string;
  /** Platform specific error code (e.g. CBError.Code rawValue, GATT status). */
  nativeCode?: string;
  /** Platform specific error domain or exception class, for developer mode. */
  nativeDomain?: string;
}

export class BleError extends Error implements BleErrorInfo {
  override readonly name = 'BleError';
  readonly code: BleErrorCode;
  readonly nativeCode: string | undefined;
  readonly nativeDomain: string | undefined;

  constructor(info: BleErrorInfo, options?: { cause?: unknown }) {
    super(info.message, options);
    this.code = info.code;
    this.nativeCode = info.nativeCode;
    this.nativeDomain = info.nativeDomain;
  }

  toInfo(): BleErrorInfo {
    const info: BleErrorInfo = { code: this.code, message: this.message };
    if (this.nativeCode !== undefined) {
      info.nativeCode = this.nativeCode;
    }
    if (this.nativeDomain !== undefined) {
      info.nativeDomain = this.nativeDomain;
    }
    return info;
  }
}

export function isBleError(value: unknown): value is BleError {
  return value instanceof BleError;
}

/**
 * Converts any thrown value into a BleError without losing information.
 * Promise rejections from the native bridge arrive as plain Error objects whose
 * `code` property carries the BleErrorCode string (React Native convention).
 */
export function toBleError(
  value: unknown,
  fallbackCode: BleErrorCode = 'unknown',
): BleError {
  if (isBleError(value)) {
    return value;
  }
  if (isBleErrorInfo(value)) {
    return new BleError(value);
  }
  if (value instanceof Error) {
    const code = readErrorCode(value);
    return new BleError(
      { code: code ?? fallbackCode, message: value.message },
      { cause: value },
    );
  }
  return new BleError({ code: fallbackCode, message: String(value) }, { cause: value });
}

/** A plain `BleErrorInfo` object, as carried by "ble.error" events. */
export function isBleErrorInfo(value: unknown): value is BleErrorInfo {
  if (typeof value !== 'object' || value === null || value instanceof Error) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isBleErrorCode(candidate.code) &&
    typeof candidate.message === 'string' &&
    (candidate.nativeCode === undefined || typeof candidate.nativeCode === 'string') &&
    (candidate.nativeDomain === undefined || typeof candidate.nativeDomain === 'string')
  );
}

function readErrorCode(error: Error): BleErrorCode | undefined {
  if (!('code' in error)) {
    return undefined;
  }
  const candidate: unknown = error.code;
  return isBleErrorCode(candidate) ? candidate : undefined;
}
