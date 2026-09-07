import type { BleError, WriteMode } from '@beacon/ble-contracts';

/**
 * State of the read/write controls for one characteristic (PROJECT.md 15, 29).
 * Only one operation runs at a time from the UI; native serializes further
 * behind that. The packet log holds the values themselves; this tracks what is
 * in flight and how the last operation ended so the screen can say so.
 */
export type OperationBusy = 'idle' | 'reading' | 'writing';

export type OperationOutcome =
  | { kind: 'read'; ok: true; byteCount: number; at: string }
  | { kind: 'read'; ok: false; error: BleError; at: string }
  | { kind: 'write'; ok: true; byteCount: number; mode: WriteMode; at: string }
  | { kind: 'write'; ok: false; error: BleError; mode: WriteMode; at: string };

export interface CharacteristicOperationState {
  busy: OperationBusy;
  lastOutcome?: OperationOutcome;
}

export type CharacteristicOperationAction =
  | { type: 'read_started' }
  | { type: 'read_succeeded'; byteCount: number; at: string }
  | { type: 'read_failed'; error: BleError; at: string }
  | { type: 'write_started'; mode: WriteMode }
  | { type: 'write_succeeded'; byteCount: number; mode: WriteMode; at: string }
  | { type: 'write_failed'; error: BleError; mode: WriteMode; at: string }
  | { type: 'reset' };

export const initialOperationState: CharacteristicOperationState = { busy: 'idle' };

export function characteristicOperationReducer(
  state: CharacteristicOperationState,
  action: CharacteristicOperationAction,
): CharacteristicOperationState {
  switch (action.type) {
    case 'read_started':
      return state.busy === 'idle' ? { ...state, busy: 'reading' } : state;
    case 'write_started':
      return state.busy === 'idle' ? { ...state, busy: 'writing' } : state;
    case 'read_succeeded':
      return {
        busy: 'idle',
        lastOutcome: {
          kind: 'read',
          ok: true,
          byteCount: action.byteCount,
          at: action.at,
        },
      };
    case 'read_failed':
      return {
        busy: 'idle',
        lastOutcome: { kind: 'read', ok: false, error: action.error, at: action.at },
      };
    case 'write_succeeded':
      return {
        busy: 'idle',
        lastOutcome: {
          kind: 'write',
          ok: true,
          byteCount: action.byteCount,
          mode: action.mode,
          at: action.at,
        },
      };
    case 'write_failed':
      return {
        busy: 'idle',
        lastOutcome: {
          kind: 'write',
          ok: false,
          error: action.error,
          mode: action.mode,
          at: action.at,
        },
      };
    case 'reset':
      return initialOperationState;
  }
}

function pluralBytes(count: number): string {
  return count === 1 ? '1 byte' : `${count} bytes`;
}

/** One line for the status row: what happened last, with the error code when it failed. */
export function describeOutcome(outcome: OperationOutcome): {
  value: string;
  detail: string;
} {
  if (outcome.kind === 'read') {
    return outcome.ok
      ? { value: 'Read', detail: `Read ${pluralBytes(outcome.byteCount)}.` }
      : {
          value: 'Read failed',
          detail: `${outcome.error.message} (${outcome.error.code})`,
        };
  }
  const how = outcome.mode === 'with_response' ? 'with response' : 'without response';
  return outcome.ok
    ? { value: 'Written', detail: `Wrote ${pluralBytes(outcome.byteCount)} ${how}.` }
    : {
        value: 'Write failed',
        detail: `${outcome.error.message} (${outcome.error.code})`,
      };
}

export function describeBusy(busy: OperationBusy): string | undefined {
  switch (busy) {
    case 'reading':
      return 'Reading…';
    case 'writing':
      return 'Writing…';
    case 'idle':
      return undefined;
  }
}
