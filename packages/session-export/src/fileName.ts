import type { BleSession } from '@beacon/ble-contracts';

export type ExportFormat = 'json' | 'csv';

export const EXPORT_MIME_TYPES: Readonly<Record<ExportFormat, string>> = {
  json: 'application/json',
  csv: 'text/csv',
};

/**
 * A file name a person can recognize in a share sheet or a downloads folder:
 * the device, the start instant, and the format. Everything outside a safe
 * set is replaced so the name survives every platform's file system.
 */
export function exportFileName(session: BleSession, format: ExportFormat): string {
  const label = sanitize(session.deviceName ?? session.deviceId);
  const stamp = session.startedAt.replace(/[:.]/g, '-').replace(/Z$/, '');
  return `beacon-${label}-${stamp}.${format}`;
}

function sanitize(value: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned.toLowerCase() : 'session';
}
