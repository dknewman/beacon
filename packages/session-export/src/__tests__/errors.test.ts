import { ExportError, isExportErrorCode, toExportError } from '../errors';

describe('toExportError', () => {
  it('returns an ExportError unchanged', () => {
    const original = new ExportError('export_write_failed', 'no space');
    expect(toExportError(original)).toBe(original);
  });

  it('reads the code a native rejection carries', () => {
    const rejection = Object.assign(new Error('sheet unavailable'), {
      code: 'export_share_failed',
    });
    const error = toExportError(rejection);
    expect(error.code).toBe('export_share_failed');
    expect(error.message).toBe('sheet unavailable');
    expect(error.cause).toBe(rejection);
  });

  it('falls back when the code is not one of ours', () => {
    const rejection = Object.assign(new Error('odd'), { code: 'ENOENT' });
    expect(toExportError(rejection).code).toBe('export_unknown');
  });

  it('honours a caller-supplied fallback', () => {
    expect(toExportError(new Error('x'), 'export_write_failed').code).toBe(
      'export_write_failed',
    );
  });

  it('handles a thrown non-error', () => {
    const error = toExportError('just a string');
    expect(error.code).toBe('export_unknown');
    expect(error.message).toBe('just a string');
  });

  it('recognises only its own codes', () => {
    expect(isExportErrorCode('export_file_missing')).toBe(true);
    expect(isExportErrorCode('read_failed')).toBe(false);
  });
});
