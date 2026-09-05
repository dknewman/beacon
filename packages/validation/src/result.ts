/**
 * Minimal discriminated result type used at the native boundary so callers
 * decide how to react to invalid payloads (drop, log, surface) instead of
 * catching thrown exceptions in event handlers.
 */
export type ValidationResult<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): ValidationResult<T, never> {
  return { ok: true, value };
}

export function fail<E>(error: E): ValidationResult<never, E> {
  return { ok: false, error };
}
