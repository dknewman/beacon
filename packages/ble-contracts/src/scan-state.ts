/** Scanning lifecycle. Owned by the Scan Coordinator (M2). */
export const SCAN_STATES = [
  'idle',
  'starting',
  'scanning',
  'stopping',
  'failed',
] as const;

export type ScanState = (typeof SCAN_STATES)[number];
