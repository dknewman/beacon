import {
  describeExportButton,
  describeExportStatus,
  EXPORT_PRIVACY_NOTE,
  formatLabel,
} from '../exportPresentation';
import type { ExportPhase } from '../exportReducer';

const idle: ExportPhase = { phase: 'idle' };

describe('describeExportButton', () => {
  it('offers both formats while idle', () => {
    expect(describeExportButton(idle, 'json')).toEqual({
      label: 'Export JSON',
      enabled: true,
    });
    expect(describeExportButton(idle, 'csv')).toEqual({
      label: 'Export CSV',
      enabled: true,
    });
  });

  it('shows progress on the running format and disables the other', () => {
    const preparing: ExportPhase = { phase: 'preparing', format: 'json' };
    expect(describeExportButton(preparing, 'json')).toEqual({
      label: 'Preparing JSON…',
      enabled: false,
    });
    expect(describeExportButton(preparing, 'csv')).toEqual({
      label: 'Export CSV',
      enabled: false,
    });
  });

  it('says sharing while the sheet is open', () => {
    const sharing: ExportPhase = { phase: 'sharing', format: 'csv', fileName: 'a.csv' };
    expect(describeExportButton(sharing, 'csv').label).toBe('Sharing CSV…');
  });
});

describe('describeExportStatus', () => {
  it('says nothing before the first export', () => {
    expect(describeExportStatus(idle)).toBeUndefined();
  });

  it('describes each phase', () => {
    expect(describeExportStatus({ phase: 'preparing', format: 'json' })).toBe(
      'Building the JSON document…',
    );
    expect(
      describeExportStatus({ phase: 'sharing', format: 'json', fileName: 'a.json' }),
    ).toBe('a.json is open in the share sheet.');
  });

  it('claims only that a shared file reached the sheet, not that it was delivered', () => {
    const text = describeExportStatus({
      phase: 'idle',
      lastOutcome: { kind: 'shared', format: 'json', fileName: 'a.json' },
    });
    expect(text).toBe('a.json was handed to the share sheet.');
    expect(text).not.toContain('sent');
  });

  it('reports a dismissal and a failure', () => {
    expect(
      describeExportStatus({
        phase: 'idle',
        lastOutcome: { kind: 'dismissed', format: 'csv', fileName: 'a.csv' },
      }),
    ).toContain('closed without sharing');
    expect(
      describeExportStatus({
        phase: 'idle',
        lastOutcome: { kind: 'failed', format: 'csv', message: 'disk full' },
      }),
    ).toBe('The CSV export failed: disk full');
  });
});

describe('labels', () => {
  it('names the formats as people write them', () => {
    expect(formatLabel('json')).toBe('JSON');
    expect(formatLabel('csv')).toBe('CSV');
  });

  it('warns that an export carries the device identifier', () => {
    expect(EXPORT_PRIVACY_NOTE).toContain('device identifier');
  });
});
