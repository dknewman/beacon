import { BleError } from '@beacon/ble-contracts';
import type { BluetoothReadiness } from '../../bluetooth/readiness/bluetoothReadiness';
import { presentScanButton, presentScanSummary } from '../scanPresentation';

const ready: BluetoothReadiness = { kind: 'ready' };
const off: BluetoothReadiness = { kind: 'powered_off' };
const error = new BleError({ code: 'scan_failed', message: 'Scanning too frequently' });

describe('presentScanButton', () => {
  it('offers start only when ready and not already active', () => {
    expect(presentScanButton(ready, { phase: 'idle' })).toEqual({
      label: 'Scan',
      intent: 'start',
    });
    expect(presentScanButton(ready, { phase: 'failed', error })).toEqual({
      label: 'Scan again',
      intent: 'start',
    });
    expect(presentScanButton(off, { phase: 'idle' })).toEqual({ label: 'Scan' });
  });

  it('offers stop while scanning and disables during transitions', () => {
    expect(presentScanButton(ready, { phase: 'scanning' })).toEqual({
      label: 'Stop scanning',
      intent: 'stop',
    });
    expect(presentScanButton(ready, { phase: 'starting' })).toEqual({
      label: 'Starting…',
    });
    expect(presentScanButton(ready, { phase: 'stopping' })).toEqual({
      label: 'Stopping…',
    });
  });
});

describe('presentScanSummary', () => {
  it('describes each phase with the visible count', () => {
    expect(presentScanSummary({ phase: 'idle' }, 0, 0, false).title).toBe(
      'Nearby devices',
    );
    expect(presentScanSummary({ phase: 'idle' }, 2, 2, false).detail).toContain(
      'last scan',
    );
    expect(presentScanSummary({ phase: 'scanning' }, 0, 0, false).detail).toBe(
      'Listening for advertisements…',
    );
    expect(presentScanSummary({ phase: 'scanning' }, 0, 3, true).detail).toBe(
      'No devices match the current filters.',
    );
    expect(presentScanSummary({ phase: 'scanning' }, 2, 5, true)).toEqual({
      title: 'Nearby devices (2)',
      detail: '3 hidden by filters or not seen recently.',
    });
    expect(presentScanSummary({ phase: 'failed', error }, 0, 0, false)).toEqual({
      title: 'Scan failed',
      detail: 'Scanning too frequently (scan_failed)',
    });
  });
});
