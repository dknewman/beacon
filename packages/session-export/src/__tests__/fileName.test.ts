import { EXPORT_MIME_TYPES, exportFileName } from '../fileName';
import { session } from './fixtures';

describe('exportFileName', () => {
  it('uses the device name, the start instant and the format', () => {
    expect(exportFileName(session, 'json')).toBe(
      'beacon-polar-h10-1a2b3c-2026-01-02T10-31-02-102.json',
    );
    expect(exportFileName(session, 'csv').endsWith('.csv')).toBe(true);
  });

  it('falls back to the device id when there is no name', () => {
    const { deviceName: _deviceName, ...anonymous } = session;
    expect(exportFileName(anonymous, 'json')).toContain('mock-hrm-0001');
  });

  it('replaces characters a file system would reject', () => {
    const name = exportFileName(
      { ...session, deviceName: 'a/b\\c:d*e?f"g<h>i|j' },
      'json',
    );
    expect(name).toBe('beacon-a-b-c-d-e-f-g-h-i-j-2026-01-02T10-31-02-102.json');
  });

  it('falls back when the name has nothing usable left', () => {
    expect(exportFileName({ ...session, deviceName: '///' }, 'csv')).toContain(
      'beacon-session-',
    );
  });

  it('caps a very long name', () => {
    const name = exportFileName({ ...session, deviceName: 'x'.repeat(200) }, 'json');
    expect(name.length).toBeLessThan(80);
  });

  it('maps each format to its media type', () => {
    expect(EXPORT_MIME_TYPES.json).toBe('application/json');
    expect(EXPORT_MIME_TYPES.csv).toBe('text/csv');
  });
});
