import type { BleError, GattService } from '@beacon/ble-contracts';

/**
 * Per-device GATT table state (PROJECT.md 15). Native discovers the table
 * while connecting; this machine tracks the JavaScript side's copy of it and
 * clears it when the link ends, so a stale table never outlives its connection.
 */
export type GattStatus =
  | { phase: 'idle' }
  | { phase: 'discovering' }
  | { phase: 'ready'; services: GattService[] }
  | { phase: 'failed'; error: BleError };

export type GattState = Readonly<Record<string, GattStatus>>;

export type GattAction =
  | { type: 'discovery_requested'; deviceId: string }
  | { type: 'discovery_succeeded'; deviceId: string; services: GattService[] }
  | { type: 'discovery_failed'; deviceId: string; error: BleError }
  /** The link ended; whatever was known about the table is gone with it. */
  | { type: 'link_ended'; deviceId: string };

export const initialGattState: GattState = {};

export const idleGattStatus: GattStatus = { phase: 'idle' };

export function gattStatusOf(state: GattState, deviceId: string): GattStatus {
  return state[deviceId] ?? idleGattStatus;
}

export function gattReducer(state: GattState, action: GattAction): GattState {
  const current = gattStatusOf(state, action.deviceId);
  const next = reduceOne(current, action);
  if (next === current) {
    return state;
  }
  if (next === undefined) {
    const { [action.deviceId]: _removed, ...rest } = state;
    return rest;
  }
  return { ...state, [action.deviceId]: next };
}

function reduceOne(current: GattStatus, action: GattAction): GattStatus | undefined {
  switch (action.type) {
    case 'discovery_requested':
      return current.phase === 'discovering' ? current : { phase: 'discovering' };
    case 'discovery_succeeded':
      return current.phase === 'discovering'
        ? { phase: 'ready', services: action.services }
        : current;
    case 'discovery_failed':
      return current.phase === 'discovering'
        ? { phase: 'failed', error: action.error }
        : current;
    case 'link_ended':
      return current.phase === 'idle' ? current : undefined;
  }
}
