import {
  CSV_COLUMNS,
  CSV_TABLE_HEADER_INDEX,
  toCsvExport,
  toSessionSummaryCsv,
} from '../csv';
import { events, session } from './fixtures';

const lines = (text: string): string[] => text.trimEnd().split('\r\n');
/** Rows of the event table: its header row and everything after it. */
const table = (text: string): string[] => lines(text).slice(CSV_TABLE_HEADER_INDEX);

describe('toCsvExport', () => {
  it('leads with a summary block naming the session, then a blank line', () => {
    const rows = lines(toCsvExport(session, events));
    expect(rows[0]).toBe('field,value');
    expect(rows).toContain('id,ses-abc-1');
    expect(rows).toContain('deviceName,Polar H10 1A2B3C');
    expect(rows[CSV_TABLE_HEADER_INDEX - 1]).toBe('');
  });

  it('writes a table header and one row per event', () => {
    const rows = table(toCsvExport(session, events));
    expect(rows[0]).toBe(CSV_COLUMNS.join(','));
    expect(rows).toHaveLength(events.length + 1);
  });

  it('terminates every row, including the last', () => {
    expect(toCsvExport(session, events).endsWith('\r\n')).toBe(true);
  });

  it('shortens SIG UUIDs and renders bytes as hex with a count', () => {
    expect(table(toCsvExport(session, events))[5]).toBe(
      '5,2026-01-02T10:31:08.522Z,notification,180D,2A37,,00 48,2',
    );
  });

  it('keeps a vendor UUID that has no short form', () => {
    expect(table(toCsvExport(session, events))[7]).toContain(
      '6E400002-B5A3-F393-E0A9-E50E24DCCA9E',
    );
  });

  it('can be asked for full UUIDs', () => {
    expect(table(toCsvExport(session, events, { fullUuids: true }))[5]).toContain(
      '0000180D-0000-1000-8000-00805F9B34FB',
    );
  });

  it('puts a readable detail on the kinds that carry no bytes', () => {
    const rows = table(toCsvExport(session, events));
    expect(rows[1]).toContain('connected');
    expect(rows[2]).toContain('-52 dBm');
    expect(rows[3]).toContain('5 services, 12 characteristics');
    expect(rows[4]).toContain('subscribed');
    expect(rows[8]).toContain('read_failed');
  });

  it('leaves the byte columns empty rather than zero for a non-packet event', () => {
    expect(table(toCsvExport(session, events))[2]?.endsWith(',,')).toBe(true);
  });

  it('records an empty write as zero bytes, not as a missing value', () => {
    expect(table(toCsvExport(session, events))[7]?.endsWith(',,0')).toBe(true);
  });

  it('honours a custom newline', () => {
    const text = toCsvExport(session, events, { newline: '\n' });
    expect(text).not.toContain('\r');
    expect(text.split('\n')).toHaveLength(CSV_TABLE_HEADER_INDEX + events.length + 2);
  });
});

describe('CSV escaping', () => {
  const withDetail = (message: string) => [
    {
      ...events[0]!,
      kind: 'error' as const,
      error: { code: 'read_failed' as const, message },
    },
  ];
  const detailRow = (message: string): string =>
    table(toCsvExport(session, withDetail(message)))[1] ?? '';

  it('quotes a field containing a comma', () => {
    expect(detailRow('one, two')).toContain('"one, two (read_failed)"');
  });

  it('doubles embedded quotes', () => {
    expect(detailRow('say "hi"')).toContain('"say ""hi"" (read_failed)"');
  });

  it('quotes a field containing a newline', () => {
    const text = toCsvExport(session, withDetail('line one\nline two'));
    expect(text).toContain('"line one\nline two (read_failed)"');
  });

  it('neutralises a value a spreadsheet would treat as a formula', () => {
    expect(detailRow('=cmd|calc')).toContain("'=cmd|calc");
  });
});

describe('toSessionSummaryCsv', () => {
  it('writes the session fields as key and value rows', () => {
    const rows = lines(toSessionSummaryCsv(session));
    expect(rows[0]).toBe('field,value');
    expect(rows).toContain('id,ses-abc-1');
    expect(rows).toContain('deviceName,Polar H10 1A2B3C');
    expect(rows).toContain('packetCount,3');
  });

  it('leaves the end empty for a session that is still recording', () => {
    const { endedAt: _endedAt, ...open } = session;
    expect(lines(toSessionSummaryCsv(open))).toContain('endedAt,');
  });
});
