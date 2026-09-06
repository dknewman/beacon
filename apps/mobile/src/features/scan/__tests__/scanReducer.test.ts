import { BleError } from '@beacon/ble-contracts';
import { initialScanStatus, scanReducer, type ScanStatus } from '../scanReducer';

const error = new BleError({ code: 'scan_failed', message: 'boom' });
const failed: ScanStatus = { phase: 'failed', error };

describe('scanReducer', () => {
  it('walks the happy path idle → starting → scanning → stopping → idle', () => {
    const starting = scanReducer(initialScanStatus, { type: 'start_requested' });
    expect(starting).toEqual({ phase: 'starting' });
    const scanning = scanReducer(starting, { type: 'start_succeeded' });
    expect(scanning).toEqual({ phase: 'scanning' });
    const stopping = scanReducer(scanning, { type: 'stop_requested' });
    expect(stopping).toEqual({ phase: 'stopping' });
    expect(scanReducer(stopping, { type: 'stop_succeeded' })).toEqual({ phase: 'idle' });
  });

  it('allows a restart straight from failed', () => {
    expect(scanReducer(failed, { type: 'start_requested' })).toEqual({
      phase: 'starting',
    });
  });

  it('records start, stop and native failures', () => {
    expect(scanReducer({ phase: 'starting' }, { type: 'start_failed', error })).toEqual(
      failed,
    );
    expect(scanReducer({ phase: 'stopping' }, { type: 'stop_failed', error })).toEqual(
      failed,
    );
    expect(scanReducer({ phase: 'scanning' }, { type: 'native_failed', error })).toEqual(
      failed,
    );
  });

  it('lets a stop requested during start win over the late start result', () => {
    const stopping = scanReducer({ phase: 'starting' }, { type: 'stop_requested' });
    expect(scanReducer(stopping, { type: 'start_succeeded' })).toBe(stopping);
    expect(scanReducer(stopping, { type: 'start_failed', error })).toBe(stopping);
  });

  it('ignores actions that do not apply to the current phase', () => {
    expect(scanReducer(initialScanStatus, { type: 'stop_requested' })).toBe(
      initialScanStatus,
    );
    expect(scanReducer(initialScanStatus, { type: 'native_failed', error })).toBe(
      initialScanStatus,
    );
    expect(scanReducer(failed, { type: 'native_failed', error })).toBe(failed);
    const scanning: ScanStatus = { phase: 'scanning' };
    expect(scanReducer(scanning, { type: 'start_requested' })).toBe(scanning);
    expect(scanReducer(scanning, { type: 'stop_succeeded' })).toBe(scanning);
  });
});
