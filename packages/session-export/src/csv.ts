import {
  bytesToHex,
  toShortUuid,
  type BleSession,
  type SessionEvent,
} from '@beacon/ble-contracts';

/**
 * Human-readable CSV export (PROJECT.md 21). Unlike the JSON document this is
 * a flattened report meant to open in a spreadsheet: a short block naming the
 * session, a blank line, then one row per event with one column per thing a
 * person scans for. Values that only some kinds carry are left empty rather
 * than given a placeholder, so a column stays sortable. The summary block is
 * what makes a shared file self-describing; the JSON export is the one to use
 * when nothing may be lost.
 */
export const CSV_COLUMNS = [
  'sequence',
  'timestamp',
  'kind',
  'service',
  'characteristic',
  'detail',
  'bytes',
  'byteCount',
] as const;

export interface CsvExportOptions {
  /** Line terminator; RFC 4180 says CRLF, which is also what spreadsheets expect. */
  newline?: string;
  /** Print full 128-bit UUIDs instead of the short 16-bit form where one exists. */
  fullUuids?: boolean;
}

export function toCsvExport(
  session: BleSession,
  events: readonly SessionEvent[],
  options: CsvExportOptions = {},
): string {
  const newline = options.newline ?? '\r\n';
  const rows = [
    ...summaryRows(session).map(row => row.map(escapeCsv).join(',')),
    '',
    CSV_COLUMNS.join(','),
    ...events.map(event => rowFor(event, options).map(escapeCsv).join(',')),
  ];
  // A trailing terminator means the last row is complete, which some parsers require.
  return `${rows.join(newline)}${newline}`;
}

/** Index of the event table's header row, once the summary block is skipped. */
export const CSV_TABLE_HEADER_INDEX = 9;

/** The session's own fields, as a two-column key/value CSV on its own. */
export function toSessionSummaryCsv(
  session: BleSession,
  options: CsvExportOptions = {},
): string {
  const newline = options.newline ?? '\r\n';
  const rows = summaryRows(session).map(row => row.map(escapeCsv).join(','));
  return `${rows.join(newline)}${newline}`;
}

function summaryRows(session: BleSession): Array<[string, string]> {
  return [
    ['field', 'value'],
    ['id', session.id],
    ['deviceId', session.deviceId],
    ['deviceName', session.deviceName ?? ''],
    ['startedAt', session.startedAt],
    ['endedAt', session.endedAt ?? ''],
    ['packetCount', String(session.packetCount)],
    ['eventCount', String(session.eventCount)],
  ];
}

function rowFor(event: SessionEvent, options: CsvExportOptions): string[] {
  const uuid = (value: string): string =>
    options.fullUuids === true ? value : (toShortUuid(value) ?? value);
  const base = [String(event.sequence), event.timestamp, event.kind];

  switch (event.kind) {
    case 'connection':
      return [...base, '', '', event.state, '', ''];
    case 'rssi':
      return [...base, '', '', `${event.rssi} dBm`, '', ''];
    case 'services_discovered':
      return [
        ...base,
        '',
        '',
        `${event.serviceCount} services, ${event.characteristicCount} characteristics`,
        '',
        '',
      ];
    case 'subscription':
      return [
        ...base,
        uuid(event.serviceUuid),
        uuid(event.characteristicUuid),
        event.enabled ? 'subscribed' : 'unsubscribed',
        '',
        '',
      ];
    case 'read':
    case 'write':
    case 'notification':
      return [
        ...base,
        uuid(event.serviceUuid),
        uuid(event.characteristicUuid),
        '',
        bytesToHex(event.bytes),
        String(event.bytes.length),
      ];
    case 'error':
      return [...base, '', '', `${event.error.message} (${event.error.code})`, '', ''];
  }
}

/**
 * RFC 4180 quoting: a field containing a comma, a quote or a newline is
 * wrapped in quotes and its own quotes are doubled. A leading character that
 * spreadsheets treat as a formula is prefixed with a quote so an exported
 * value can never execute when the file is opened.
 */
function escapeCsv(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
