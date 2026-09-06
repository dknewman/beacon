import type { BluetoothReadiness } from '../bluetooth/readiness/bluetoothReadiness';
import type { ScanStatus } from './scanReducer';

export interface ScanButtonPresentation {
  label: string;
  /** What pressing the button does; undefined when it is disabled. */
  intent?: 'start' | 'stop';
}

/** Label and intent of the single scan control for every (readiness, status) pair. */
export function presentScanButton(
  readiness: BluetoothReadiness,
  status: ScanStatus,
): ScanButtonPresentation {
  switch (status.phase) {
    case 'starting':
      return { label: 'Starting…' };
    case 'scanning':
      return { label: 'Stop scanning', intent: 'stop' };
    case 'stopping':
      return { label: 'Stopping…' };
    case 'idle':
    case 'failed':
      return readiness.kind === 'ready'
        ? { label: status.phase === 'failed' ? 'Scan again' : 'Scan', intent: 'start' }
        : { label: 'Scan' };
  }
}

export interface ScanSummary {
  title: string;
  detail: string;
}

/** Text shown above the list (or in place of it while empty). */
export function presentScanSummary(
  status: ScanStatus,
  visibleCount: number,
  seenCount: number,
  filtering: boolean,
): ScanSummary {
  const hidden = seenCount - visibleCount;
  switch (status.phase) {
    case 'idle':
      return seenCount === 0
        ? { title: 'Nearby devices', detail: 'Start a scan to discover peripherals.' }
        : {
            title: `Nearby devices (${visibleCount})`,
            detail: 'Scan stopped. Results are from the last scan.',
          };
    case 'starting':
      return { title: 'Nearby devices', detail: 'Starting the scanner…' };
    case 'scanning':
      return {
        title: `Nearby devices (${visibleCount})`,
        detail:
          visibleCount === 0
            ? filtering
              ? 'No devices match the current filters.'
              : 'Listening for advertisements…'
            : hidden > 0
              ? `${hidden} hidden by filters or not seen recently.`
              : 'Sorted by signal strength.',
      };
    case 'stopping':
      return { title: `Nearby devices (${visibleCount})`, detail: 'Stopping…' };
    case 'failed':
      return {
        title: 'Scan failed',
        detail: `${status.error.message} (${status.error.code})`,
      };
  }
}
