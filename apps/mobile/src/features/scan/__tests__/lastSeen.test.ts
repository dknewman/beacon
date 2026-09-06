import { describeLastSeen } from '../lastSeen';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('describeLastSeen', () => {
  it('rounds to coarse, stable buckets', () => {
    expect(describeLastSeen(ago(0), NOW)).toBe('now');
    expect(describeLastSeen(ago(1_999), NOW)).toBe('now');
    expect(describeLastSeen(ago(2_000), NOW)).toBe('2 s ago');
    expect(describeLastSeen(ago(59_999), NOW)).toBe('59 s ago');
    expect(describeLastSeen(ago(60_000), NOW)).toBe('1 min ago');
    expect(describeLastSeen(ago(3_600_000), NOW)).toBe('1 h ago');
  });

  it('never reports the future or garbage', () => {
    expect(describeLastSeen(ago(-5_000), NOW)).toBe('now');
    expect(describeLastSeen('not a date', NOW)).toBe('unknown');
  });
});
