import type { BleError, ScanState } from '@beacon/ble-contracts';

/**
 * Explicit scan lifecycle for the application layer (PROJECT.md 8, 11).
 * `phase` uses the shared ScanState vocabulary so the UI, the coordinator and
 * later the session recorder speak the same names.
 */
export type ScanStatus =
  | { phase: Extract<ScanState, 'idle'> }
  | { phase: Extract<ScanState, 'starting'> }
  | { phase: Extract<ScanState, 'scanning'> }
  | { phase: Extract<ScanState, 'stopping'> }
  | { phase: Extract<ScanState, 'failed'>; error: BleError };

export type ScanAction =
  | { type: 'start_requested' }
  | { type: 'start_succeeded' }
  | { type: 'start_failed'; error: BleError }
  | { type: 'stop_requested' }
  | { type: 'stop_succeeded' }
  | { type: 'stop_failed'; error: BleError }
  /** The platform scanner stopped on its own (Android onScanFailed, radio loss). */
  | { type: 'native_failed'; error: BleError };

export const initialScanStatus: ScanStatus = { phase: 'idle' };

/**
 * Transition table:
 *
 *   idle|failed ──start_requested──► starting ──start_succeeded──► scanning
 *   starting|scanning ──stop_requested──► stopping ──stop_succeeded──► idle
 *   starting ──start_failed──► failed
 *   stopping ──stop_failed──► failed
 *   starting|scanning|stopping ──native_failed──► failed
 *
 * Every other (state, action) pair is a no-op, which is what makes the
 * coordinator safe against late promise results after a stop or a retry.
 */
export function scanReducer(status: ScanStatus, action: ScanAction): ScanStatus {
  switch (action.type) {
    case 'start_requested':
      return status.phase === 'idle' || status.phase === 'failed'
        ? { phase: 'starting' }
        : status;
    case 'start_succeeded':
      return status.phase === 'starting' ? { phase: 'scanning' } : status;
    case 'start_failed':
      return status.phase === 'starting'
        ? { phase: 'failed', error: action.error }
        : status;
    case 'stop_requested':
      return status.phase === 'starting' || status.phase === 'scanning'
        ? { phase: 'stopping' }
        : status;
    case 'stop_succeeded':
      return status.phase === 'stopping' ? { phase: 'idle' } : status;
    case 'stop_failed':
      return status.phase === 'stopping'
        ? { phase: 'failed', error: action.error }
        : status;
    case 'native_failed':
      return status.phase === 'idle' || status.phase === 'failed'
        ? status
        : { phase: 'failed', error: action.error };
  }
}
