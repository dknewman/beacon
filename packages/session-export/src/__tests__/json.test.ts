import {
  buildSessionExport,
  ExportParseError,
  JSON_EXPORT_VERSION,
  parseJsonExport,
  toJsonExport,
} from '../json';
import { events, session } from './fixtures';

const OPTIONS = { exportedAt: '2026-02-01T00:00:00.000Z' };

describe('toJsonExport', () => {
  it('preserves the session and every event through a round trip', () => {
    const document = parseJsonExport(toJsonExport(session, events, OPTIONS));

    expect(document.session).toEqual(session);
    expect(document.events).toEqual(events);
    expect(document.events).toHaveLength(8);
  });

  it('keeps every field of every event kind', () => {
    const document = parseJsonExport(toJsonExport(session, events, OPTIONS));

    // Deep equality can pass on a subset if a field is dropped from both
    // sides, so check each event still carries the keys its kind defines.
    const kinds = document.events.map(event => event.kind);
    expect(new Set(kinds).size).toBe(8);
    for (const [index, event] of document.events.entries()) {
      expect(Object.keys(event).sort()).toEqual(Object.keys(events[index]!).sort());
    }
  });

  it('is byte-stable: re-exporting a parsed document reproduces the file', () => {
    const first = toJsonExport(session, events, OPTIONS);
    const document = parseJsonExport(first);
    const second = toJsonExport(document.session, document.events, {
      exportedAt: document.exportedAt,
    });
    expect(second).toBe(first);
  });

  it('writes the same bytes regardless of the key order it was handed', () => {
    const shuffled = events.map(event =>
      Object.fromEntries(Object.entries(event).reverse()),
    ) as typeof events;
    expect(toJsonExport(session, shuffled, OPTIONS)).toBe(
      toJsonExport(session, events, OPTIONS),
    );
  });

  it('carries the version, generator and export instant', () => {
    const document = buildSessionExport(session, events, OPTIONS);
    expect(document.version).toBe(JSON_EXPORT_VERSION);
    expect(document.generator).toBe('beacon');
    expect(document.exportedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('defaults the export instant to now', () => {
    const before = Date.now();
    const document = buildSessionExport(session, events);
    expect(Date.parse(document.exportedAt)).toBeGreaterThanOrEqual(before);
  });

  it('copies the events so a later mutation cannot change the document', () => {
    const mutable = [...events];
    const document = buildSessionExport(session, mutable, OPTIONS);
    mutable.pop();
    expect(document.events).toHaveLength(8);
  });

  it('ends with a newline and is indented by default', () => {
    const text = toJsonExport(session, events, OPTIONS);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "version": 1');
  });

  it('can be written compactly', () => {
    const text = toJsonExport(session, events, { ...OPTIONS, indent: 0 });
    expect(text).not.toContain('\n  "version"');
    expect(parseJsonExport(text).events).toEqual(events);
  });

  it('round trips a session that is still recording', () => {
    const { endedAt: _endedAt, ...open } = session;
    const document = parseJsonExport(toJsonExport(open, [], OPTIONS));
    expect(document.session.endedAt).toBeUndefined();
    expect(document.events).toEqual([]);
  });
});

describe('parseJsonExport', () => {
  it('rejects text that is not JSON', () => {
    expect(() => parseJsonExport('{oops')).toThrow(ExportParseError);
  });

  it('rejects a document that is not an object', () => {
    expect(() => parseJsonExport('[]')).toThrow('not an object');
  });

  it('rejects an unsupported version', () => {
    const text = toJsonExport(session, events, OPTIONS).replace(
      '"version": 1',
      '"version": 99',
    );
    expect(() => parseJsonExport(text)).toThrow('Unsupported export version 99');
  });

  it('rejects a session that fails the schema', () => {
    const text = toJsonExport(session, events, OPTIONS).replace(
      '"deviceId": "MOCK-HRM-0001"',
      '"deviceId": 42',
    );
    expect(() => parseJsonExport(text)).toThrow('The session is invalid');
  });

  it('names the event that fails the schema', () => {
    const text = toJsonExport(session, events, OPTIONS).replace(
      '"rssi": -52',
      '"rssi": "loud"',
    );
    expect(() => parseJsonExport(text)).toThrow('Event 1 is invalid');
  });

  it('rejects a document with no events array', () => {
    const text = JSON.stringify({
      version: 1,
      generator: 'beacon',
      exportedAt: OPTIONS.exportedAt,
      session,
    });
    expect(() => parseJsonExport(text)).toThrow('no events array');
  });
});
