import { isScanActive, isScanState, SCAN_STATES } from '../scan-state';

describe('scan state', () => {
  it('matches the PROJECT.md union verbatim', () => {
    expect(SCAN_STATES).toEqual(['idle', 'starting', 'scanning', 'stopping', 'failed']);
  });

  it('guards arbitrary values', () => {
    expect(isScanState('scanning')).toBe(true);
    expect(isScanState('SCANNING')).toBe(false);
    expect(isScanState(undefined)).toBe(false);
  });

  it('treats starting and scanning as active', () => {
    expect(SCAN_STATES.filter(isScanActive)).toEqual(['starting', 'scanning']);
  });
});
