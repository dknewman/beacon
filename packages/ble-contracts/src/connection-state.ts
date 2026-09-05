/**
 * Per-device connection lifecycle.
 *
 * Happy path: disconnected -> connecting -> connected -> discovering_services -> ready
 * Failure:    any state -> failed -> disconnected
 *
 * Native code is the source of truth for these transitions; JavaScript mirrors
 * them through validated "connection.state_changed" events (see NativeBleEvent).
 * The transition table itself is introduced with the connection coordinator (M3).
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
