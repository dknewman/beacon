import {
  exportReducer,
  initialExportState,
  isExporting,
  type ExportAction,
  type ExportPhase,
} from '../exportReducer';

const reduce = (actions: ExportAction[], from: ExportPhase = initialExportState) =>
  actions.reduce(exportReducer, from);

describe('exportReducer', () => {
  it('starts idle with no outcome', () => {
    expect(initialExportState).toEqual({ phase: 'idle' });
    expect(isExporting(initialExportState)).toBe(false);
  });

  it('moves idle to preparing to sharing to idle', () => {
    const preparing = reduce([{ type: 'export_requested', format: 'json' }]);
    expect(preparing).toEqual({ phase: 'preparing', format: 'json' });
    expect(isExporting(preparing)).toBe(true);

    const sharing = exportReducer(preparing, {
      type: 'file_written',
      format: 'json',
      fileName: 'beacon-a.json',
    });
    expect(sharing).toEqual({
      phase: 'sharing',
      format: 'json',
      fileName: 'beacon-a.json',
    });

    const done = exportReducer(sharing, { type: 'share_settled', shared: true });
    expect(done).toEqual({
      phase: 'idle',
      lastOutcome: { kind: 'shared', format: 'json', fileName: 'beacon-a.json' },
    });
  });

  it('records a dismissal distinctly from a completed share', () => {
    const state = reduce([
      { type: 'export_requested', format: 'csv' },
      { type: 'file_written', format: 'csv', fileName: 'beacon-a.csv' },
      { type: 'share_settled', shared: false },
    ]);
    expect(state).toMatchObject({
      phase: 'idle',
      lastOutcome: { kind: 'dismissed', format: 'csv' },
    });
  });

  it('ignores a second request while one is running', () => {
    const preparing = reduce([{ type: 'export_requested', format: 'json' }]);
    expect(exportReducer(preparing, { type: 'export_requested', format: 'csv' })).toBe(
      preparing,
    );
  });

  it('keeps the format that failed', () => {
    const state = reduce([
      { type: 'export_requested', format: 'csv' },
      { type: 'export_failed', message: 'disk full' },
    ]);
    expect(state).toEqual({
      phase: 'idle',
      lastOutcome: { kind: 'failed', format: 'csv', message: 'disk full' },
    });
  });

  it('can fail while the sheet is open', () => {
    const state = reduce([
      { type: 'export_requested', format: 'json' },
      { type: 'file_written', format: 'json', fileName: 'a.json' },
      { type: 'export_failed', message: 'sheet vanished' },
    ]);
    expect(state).toMatchObject({ lastOutcome: { kind: 'failed', format: 'json' } });
  });

  it('ignores a failure that arrives when nothing is running', () => {
    expect(
      exportReducer(initialExportState, { type: 'export_failed', message: 'x' }),
    ).toBe(initialExportState);
  });

  it('ignores a settled share that was never opened', () => {
    const preparing = reduce([{ type: 'export_requested', format: 'json' }]);
    expect(exportReducer(preparing, { type: 'share_settled', shared: true })).toBe(
      preparing,
    );
  });

  it('replaces the previous outcome on the next export', () => {
    const first = reduce([
      { type: 'export_requested', format: 'json' },
      { type: 'export_failed', message: 'nope' },
    ]);
    const second = exportReducer(first, { type: 'export_requested', format: 'csv' });
    expect(second).toEqual({ phase: 'preparing', format: 'csv' });
  });
});
