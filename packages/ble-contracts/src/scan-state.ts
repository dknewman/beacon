/** Scanning lifecycle. Owned by the scan coordinator (M2). */
export const SCAN_STATES = [
  'idle',
  'starting',
  'scanning',
  'stopping',
  'failed',
] as const;

export type ScanState = (typeof SCAN_STATES)[number];

export function isScanState(value: unknown): value is ScanState {
  return typeof value === 'string' && (SCAN_STATES as readonly string[]).includes(value);
}

/** True while the native scanner is, or is about to be, running. */
export function isScanActive(state: ScanState): boolean {
  return state === 'starting' || state === 'scanning';
}
