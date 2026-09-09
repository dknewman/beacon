/**
 * Failures of the export pipeline. These are deliberately separate from
 * `BleErrorCode`: writing a file and presenting a share sheet are not
 * Bluetooth operations, and folding them into the BLE union would make that
 * union mean two different things.
 */
export const EXPORT_ERROR_CODES = [
  /** The document could not be written to the temporary directory. */
  'export_write_failed',
  /** No share sheet could be presented. */
  'export_share_failed',
  /** The path handed to the share sheet is not one the module wrote. */
  'export_file_missing',
  /** The session or its events could not be read back from the store. */
  'export_source_failed',
  'export_unknown',
] as const;

export type ExportErrorCode = (typeof EXPORT_ERROR_CODES)[number];

export function isExportErrorCode(value: unknown): value is ExportErrorCode {
  return (
    typeof value === 'string' && (EXPORT_ERROR_CODES as readonly string[]).includes(value)
  );
}

export class ExportError extends Error {
  override readonly name = 'ExportError';
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

export function isExportError(value: unknown): value is ExportError {
  return value instanceof ExportError;
}

/**
 * Converts anything thrown by the bridge into an ExportError without losing
 * information. Native rejections arrive as Error objects whose `code` property
 * carries the wire string, matching the convention the BLE bridge uses.
 */
export function toExportError(
  value: unknown,
  fallbackCode: ExportErrorCode = 'export_unknown',
): ExportError {
  if (isExportError(value)) {
    return value;
  }
  if (value instanceof Error) {
    const code =
      'code' in value && isExportErrorCode(value.code) ? value.code : fallbackCode;
    return new ExportError(code, value.message, { cause: value });
  }
  return new ExportError(fallbackCode, String(value), { cause: value });
}
