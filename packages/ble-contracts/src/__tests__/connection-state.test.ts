import {
  canConnect,
  CONNECTION_STATES,
  isConnectionActive,
  isConnectionState,
} from '../connection-state';

describe('connection state', () => {
  it('matches the PROJECT.md union verbatim', () => {
    expect(CONNECTION_STATES).toEqual([
      'disconnected',
      'connecting',
      'connected',
      'discovering_services',
      'ready',
      'disconnecting',
      'failed',
    ]);
  });

  it('guards arbitrary values', () => {
    expect(isConnectionState('ready')).toBe(true);
    expect(isConnectionState('STATE_CONNECTED')).toBe(false);
    expect(isConnectionState(2)).toBe(false);
  });

  it('classifies active and connectable states', () => {
    expect(CONNECTION_STATES.filter(isConnectionActive)).toEqual([
      'connecting',
      'connected',
      'discovering_services',
      'ready',
    ]);
    expect(CONNECTION_STATES.filter(canConnect)).toEqual(['disconnected', 'failed']);
  });
});
