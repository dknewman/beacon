/**
 * Per-device connection lifecycle.
 *
 * Happy path: disconnected -> connecting -> connected -> discovering_services -> ready
 * Failure:    any state -> failed -> disconnected
 *
 * Native code is the source of truth for these transitions; JavaScript mirrors
 * them through validated "connection.state_changed" events (see NativeBleEvent).
 * The application-side transition table lives with the connection coordinator
 * (apps/mobile/src/features/connection).
 */
export const CONNECTION_STATES = [
  'disconnected',
  'connecting',
  'connected',
  'discovering_services',
  'ready',
  'disconnecting',
  'failed',
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

export function isConnectionState(value: unknown): value is ConnectionState {
  return (
    typeof value === 'string' && (CONNECTION_STATES as readonly string[]).includes(value)
  );
}

/** True while a link exists or is being established, i.e. a disconnect makes sense. */
export function isConnectionActive(state: ConnectionState): boolean {
  return (
    state === 'connecting' ||
    state === 'connected' ||
    state === 'discovering_services' ||
    state === 'ready'
  );
}

/** True when a new connection attempt may begin. */
export function canConnect(state: ConnectionState): boolean {
  return state === 'disconnected' || state === 'failed';
}
