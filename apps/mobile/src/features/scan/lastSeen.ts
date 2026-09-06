/**
 * Relative "last seen" text for the device list. Coarse on purpose: the list
 * re-renders once a second while scanning and the text must not flicker
 * between equivalent values.
 */
export function describeLastSeen(lastSeenAt: string, now: number): string {
  const seenAt = Date.parse(lastSeenAt);
  if (Number.isNaN(seenAt)) {
    return 'unknown';
  }
  const elapsedMs = Math.max(0, now - seenAt);
  if (elapsedMs < 2_000) {
    return 'now';
  }
  if (elapsedMs < 60_000) {
    return `${Math.floor(elapsedMs / 1_000)} s ago`;
  }
  if (elapsedMs < 3_600_000) {
    return `${Math.floor(elapsedMs / 60_000)} min ago`;
  }
  return `${Math.floor(elapsedMs / 3_600_000)} h ago`;
}
