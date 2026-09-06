import type { BleError, BlePermissionState } from '@beacon/ble-contracts';

/**
 * Explicit permission lifecycle for the UI layer.
 *
 * "requesting" is its own phase so the screen can disable the button while the
 * system prompt is up and so foreground re-checks can be ignored until the
 * prompt result arrives (Android backgrounds the app while the dialog shows).
 */
export type PermissionStatus =
  | { phase: 'checking' }
  | { phase: 'ready'; state: BlePermissionState }
  | { phase: 'requesting' }
  | { phase: 'failed'; error: BleError };

export type PermissionAction =
  | { type: 'state_received'; state: BlePermissionState }
  | { type: 'request_started' }
  | { type: 'request_failed'; error: BleError }
  | { type: 'retry_requested' };

export const initialPermissionStatus: PermissionStatus = { phase: 'checking' };

export function permissionReducer(
  status: PermissionStatus,
  action: PermissionAction,
): PermissionStatus {
  switch (action.type) {
    case 'state_received':
      return { phase: 'ready', state: action.state };
    case 'request_started':
      return status.phase === 'requesting' ? status : { phase: 'requesting' };
    case 'request_failed':
      return { phase: 'failed', error: action.error };
    case 'retry_requested':
      return status.phase === 'failed' ? initialPermissionStatus : status;
  }
}
