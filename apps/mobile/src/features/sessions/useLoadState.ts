import { useCallback, useEffect, useRef, useState } from 'react';

/** What a screen shows while it reads from the repository (PROJECT.md 3.3). */
export type LoadState<T> =
  | { phase: 'loading' }
  | { phase: 'ready'; value: T }
  | { phase: 'failed'; message: string };

export interface LoadHandle<T> {
  state: LoadState<T>;
  /** Runs the load again; the one control a failed state offers. */
  retry: () => void;
}

/**
 * Runs `load` whenever `enabled` turns on, `key` changes or `retry` is
 * pressed. A result that arrives after a newer request started is dropped,
 * so the screen never shows stale rows over fresh ones. A screen that is
 * already showing rows keeps them while the next read runs, so a live
 * timeline grows instead of flickering through a spinner.
 */
export function useLoadState<T>(
  load: () => Promise<T>,
  enabled: boolean,
  key: string | number,
): LoadHandle<T> {
  const [state, setState] = useState<LoadState<T>>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    request.current += 1;
    const id = request.current;
    setState(current => (current.phase === 'ready' ? current : { phase: 'loading' }));
    load().then(
      value => {
        if (request.current === id) {
          setState({ phase: 'ready', value });
        }
      },
      (error: unknown) => {
        if (request.current === id) {
          setState({ phase: 'failed', message: messageOf(error) });
        }
      },
    );
  }, [attempt, enabled, key, load]);

  const retry = useCallback(() => {
    setState({ phase: 'loading' });
    setAttempt(current => current + 1);
  }, []);

  return { state, retry };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
