import { useEffect, useState } from 'react';

/**
 * A clock that ticks while `enabled`, for relative timestamps and stale
 * hiding. Reads `Date.now()` on every tick so tests can drive it with fake
 * timers and a fixed system time.
 */
export function useNow(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    setNow(Date.now());
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs, enabled]);

  return now;
}
