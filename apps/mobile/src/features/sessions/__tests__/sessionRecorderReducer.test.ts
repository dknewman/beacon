import type { BleSession } from '@beacon/ble-contracts';
import {
  initialRecorderState,
  isCapturing,
  recordingOf,
  sessionRecorderReducer,
  type RecorderAction,
  type RecorderState,
} from '../sessionRecorderReducer';

const session: BleSession = {
  id: 'ses-1',
  deviceId: 'dev',
  startedAt: '2026-01-01T00:00:00.000Z',
  packetCount: 0,
  eventCount: 0,
};

function reduceAll(
  actions: RecorderAction[],
  from = initialRecorderState,
): RecorderState {
  return actions.reduce(sessionRecorderReducer, from);
}

const started = (): RecorderState =>
  reduceAll([
    { type: 'start_requested', deviceId: 'dev', startedAt: session.startedAt },
    { type: 'start_succeeded', deviceId: 'dev', session },
  ]);

describe('sessionRecorderReducer', () => {
  it('is idle for an unknown device', () => {
    expect(recordingOf(initialRecorderState, 'dev')).toEqual({ phase: 'idle' });
    expect(isCapturing(recordingOf(initialRecorderState, 'dev'))).toBe(false);
  });

  it('moves idle → starting → recording and bumps the revision on start', () => {
    const starting = reduceAll([
      {
        type: 'start_requested',
        deviceId: 'dev',
        startedAt: session.startedAt,
        deviceName: 'Polar',
      },
    ]);
    expect(recordingOf(starting, 'dev')).toEqual({
      phase: 'starting',
      startedAt: session.startedAt,
      deviceName: 'Polar',
    });
    expect(isCapturing(recordingOf(starting, 'dev'))).toBe(true);
    expect(starting.revision).toBe(0);

    const recording = sessionRecorderReducer(starting, {
      type: 'start_succeeded',
      deviceId: 'dev',
      session,
    });
    expect(recordingOf(recording, 'dev')).toEqual({
      phase: 'recording',
      session,
      eventCount: 0,
      packetCount: 0,
      droppedCount: 0,
    });
    expect(recording.revision).toBe(1);
  });

  it('ignores a second start while one is in progress or recording', () => {
    const state = started();
    const again = sessionRecorderReducer(state, {
      type: 'start_requested',
      deviceId: 'dev',
      startedAt: '2026-01-01T00:00:05.000Z',
    });
    expect(again).toBe(state);
  });

  it('returns to idle with the message when the start fails', () => {
    const state = reduceAll([
      { type: 'start_requested', deviceId: 'dev', startedAt: session.startedAt },
      { type: 'start_failed', deviceId: 'dev', error: 'disk full' },
    ]);
    expect(recordingOf(state, 'dev')).toEqual({ phase: 'idle', lastError: 'disk full' });
  });

  it('accumulates acknowledged counts for the open session only', () => {
    const state = reduceAll(
      [
        {
          type: 'events_appended',
          deviceId: 'dev',
          sessionId: 'ses-1',
          eventCount: 3,
          packetCount: 2,
        },
        {
          type: 'events_appended',
          deviceId: 'dev',
          sessionId: 'ses-other',
          eventCount: 9,
          packetCount: 9,
        },
      ],
      started(),
    );
    expect(recordingOf(state, 'dev')).toMatchObject({
      phase: 'recording',
      eventCount: 3,
      packetCount: 2,
    });
  });

  it('counts dropped events and keeps recording after a failed append', () => {
    const state = reduceAll(
      [
        {
          type: 'append_failed',
          deviceId: 'dev',
          sessionId: 'ses-1',
          droppedCount: 4,
          error: 'database is locked',
        },
      ],
      started(),
    );
    expect(recordingOf(state, 'dev')).toMatchObject({
      phase: 'recording',
      droppedCount: 4,
      lastError: 'database is locked',
    });
  });

  it('stops through stopping into idle with the finished session', () => {
    const stopping = reduceAll(
      [
        {
          type: 'events_appended',
          deviceId: 'dev',
          sessionId: 'ses-1',
          eventCount: 5,
          packetCount: 1,
        },
        { type: 'stop_requested', deviceId: 'dev' },
      ],
      started(),
    );
    expect(recordingOf(stopping, 'dev').phase).toBe('stopping');
    expect(isCapturing(recordingOf(stopping, 'dev'))).toBe(false);

    const stopped = sessionRecorderReducer(stopping, {
      type: 'stop_succeeded',
      deviceId: 'dev',
      endedAt: '2026-01-01T00:01:00.000Z',
    });
    expect(recordingOf(stopped, 'dev')).toEqual({
      phase: 'idle',
      lastSession: {
        ...session,
        endedAt: '2026-01-01T00:01:00.000Z',
        eventCount: 5,
        packetCount: 1,
      },
    });
    expect(stopped.revision).toBe(2);
  });

  it('keeps a late acknowledgement while stopping', () => {
    const state = reduceAll(
      [
        { type: 'stop_requested', deviceId: 'dev' },
        {
          type: 'events_appended',
          deviceId: 'dev',
          sessionId: 'ses-1',
          eventCount: 2,
          packetCount: 2,
        },
      ],
      started(),
    );
    expect(recordingOf(state, 'dev')).toMatchObject({ phase: 'stopping', eventCount: 2 });
  });

  it('returns to idle with the error when the stop fails', () => {
    const state = reduceAll(
      [
        { type: 'stop_requested', deviceId: 'dev' },
        { type: 'stop_failed', deviceId: 'dev', error: 'io' },
      ],
      started(),
    );
    expect(recordingOf(state, 'dev')).toMatchObject({ phase: 'idle', lastError: 'io' });
  });

  it('ignores stop unless recording', () => {
    const state = reduceAll([{ type: 'stop_requested', deviceId: 'dev' }]);
    expect(state).toBe(initialRecorderState);
  });

  it('bumps the revision on sessions_changed without touching devices', () => {
    const state = sessionRecorderReducer(started(), { type: 'sessions_changed' });
    expect(state.revision).toBe(2);
    expect(recordingOf(state, 'dev').phase).toBe('recording');
  });

  it('keeps devices independent', () => {
    const state = reduceAll(
      [{ type: 'start_requested', deviceId: 'other', startedAt: session.startedAt }],
      started(),
    );
    expect(recordingOf(state, 'dev').phase).toBe('recording');
    expect(recordingOf(state, 'other').phase).toBe('starting');
  });
});
