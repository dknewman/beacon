import { ExportError } from '@beacon/session-export';
import { createNativeExportClient } from '../createNativeExportClient';
import type { Spec } from '../specs/NativeBeaconExport';

function specWith(overrides: Partial<Spec>): Spec {
  return {
    writeTemporaryFile: () => Promise.resolve('/tmp/beacon/file.json'),
    shareFile: () => Promise.resolve(true),
    clearTemporaryFiles: () => Promise.resolve(0),
    ...overrides,
  } as Spec;
}

describe('createNativeExportClient', () => {
  it('forwards the name and contents and returns the path', async () => {
    const calls: Array<[string, string]> = [];
    const client = createNativeExportClient(
      specWith({
        writeTemporaryFile: (fileName, contents) => {
          calls.push([fileName, contents]);
          return Promise.resolve('/tmp/beacon/a.json');
        },
      }),
    );

    await expect(client.writeTemporaryFile('a.json', '{}')).resolves.toBe(
      '/tmp/beacon/a.json',
    );
    expect(calls).toEqual([['a.json', '{}']]);
  });

  it('turns a native write rejection into an ExportError with its code', async () => {
    const client = createNativeExportClient(
      specWith({
        writeTemporaryFile: () =>
          Promise.reject(
            Object.assign(new Error('disk full'), { code: 'export_write_failed' }),
          ),
      }),
    );

    await expect(client.writeTemporaryFile('a.json', '{}')).rejects.toMatchObject({
      name: 'ExportError',
      code: 'export_write_failed',
      message: 'disk full',
    });
  });

  it('defaults an uncoded write failure to export_write_failed', async () => {
    const client = createNativeExportClient(
      specWith({ writeTemporaryFile: () => Promise.reject(new Error('odd')) }),
    );
    await expect(client.writeTemporaryFile('a.json', '{}')).rejects.toBeInstanceOf(
      ExportError,
    );
    await expect(client.writeTemporaryFile('a.json', '{}')).rejects.toMatchObject({
      code: 'export_write_failed',
    });
  });

  it('rejects when the module returns no path', async () => {
    const client = createNativeExportClient(
      specWith({ writeTemporaryFile: () => Promise.resolve('') }),
    );
    await expect(client.writeTemporaryFile('a.json', '{}')).rejects.toMatchObject({
      code: 'export_write_failed',
      message: expect.stringContaining('no path'),
    });
  });

  it('reports a completed share and a dismissal distinctly', async () => {
    const completed = createNativeExportClient(
      specWith({ shareFile: () => Promise.resolve(true) }),
    );
    const dismissed = createNativeExportClient(
      specWith({ shareFile: () => Promise.resolve(false) }),
    );

    await expect(completed.shareFile('/tmp/a.json', 'application/json')).resolves.toBe(
      true,
    );
    await expect(dismissed.shareFile('/tmp/a.json', 'application/json')).resolves.toBe(
      false,
    );
  });

  it('passes the media type through', async () => {
    const calls: Array<[string, string]> = [];
    const client = createNativeExportClient(
      specWith({
        shareFile: (path, mimeType) => {
          calls.push([path, mimeType]);
          return Promise.resolve(true);
        },
      }),
    );
    await client.shareFile('/tmp/a.csv', 'text/csv');
    expect(calls).toEqual([['/tmp/a.csv', 'text/csv']]);
  });

  it('turns a native share rejection into an ExportError', async () => {
    const client = createNativeExportClient(
      specWith({
        shareFile: () =>
          Promise.reject(
            Object.assign(new Error('gone'), { code: 'export_file_missing' }),
          ),
      }),
    );
    await expect(
      client.shareFile('/tmp/a.json', 'application/json'),
    ).rejects.toMatchObject({ code: 'export_file_missing' });
  });

  it('rejects when the module does not say whether the share completed', async () => {
    const client = createNativeExportClient(
      specWith({ shareFile: () => Promise.resolve(undefined as unknown as boolean) }),
    );
    await expect(
      client.shareFile('/tmp/a.json', 'application/json'),
    ).rejects.toMatchObject({ code: 'export_share_failed' });
  });

  it('returns the number of files cleared, and zero for a nonsense answer', async () => {
    const counted = createNativeExportClient(
      specWith({ clearTemporaryFiles: () => Promise.resolve(3) }),
    );
    const nonsense = createNativeExportClient(
      specWith({
        clearTemporaryFiles: () => Promise.resolve(Number.NaN),
      }),
    );
    await expect(counted.clearTemporaryFiles()).resolves.toBe(3);
    await expect(nonsense.clearTemporaryFiles()).resolves.toBe(0);
  });
});
