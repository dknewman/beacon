import type { BleSession } from '@beacon/ble-contracts';

/**
 * Recording state per device (PROJECT.md 20, 29). A session is explicit: it
 * starts when a person presses Start Session and ends when they press Stop,
 * so a link that drops and comes back stays inside one recording. The
 * repository is the source of truth for what was written; this tracks what
 * is in flight and the counts the screen shows while recording.
 */
export type DeviceRecording =
  | { phase: 'idle'; lastSession?: BleSession; lastError?: string }
  | { phase: 'starting'; startedAt: string; deviceName?: string }
  | {
      phase: 'recording';
      session: BleSession;
      /** Events the repository has acknowledged. */
      eventCount: number;
      packetCount: number;
      /** Events lost because an append failed; the session is still open. */
      droppedCount: number;
      lastError?: string;
    }
  | {
      phase: 'stopping';
      session: BleSession;
      eventCount: number;
      packetCount: number;
      droppedCount: number;
    };

export interface RecorderState {
  readonly devices: Readonly<Record<string, DeviceRecording>>;
  /** Bumps whenever the set of stored sessions changes, so lists can refetch. */
  readonly revision: number;
}

export type RecorderAction =
  | { type: 'start_requested'; deviceId: string; startedAt: string; deviceName?: string }
  | { type: 'start_succeeded'; deviceId: string; session: BleSession }
  | { type: 'start_failed'; deviceId: string; error: string }
  | {
      type: 'events_appended';
      deviceId: string;
      sessionId: string;
      eventCount: number;
      packetCount: number;
    }
  | {
      type: 'append_failed';
      deviceId: string;
      sessionId: string;
      droppedCount: number;
      error: string;
    }
  | { type: 'stop_requested'; deviceId: string }
  | { type: 'stop_succeeded'; deviceId: string; endedAt: string }
  | { type: 'stop_failed'; deviceId: string; error: string }
  /** A session was deleted or repaired outside the recorder; lists should refetch. */
  | { type: 'sessions_changed' };

export const initialRecorderState: RecorderState = { devices: {}, revision: 0 };

const IDLE: DeviceRecording = { phase: 'idle' };

export function recordingOf(state: RecorderState, deviceId: string): DeviceRecording {
  return state.devices[deviceId] ?? IDLE;
}

export function sessionRecorderReducer(
  state: RecorderState,
  action: RecorderAction,
): RecorderState {
  if (action.type === 'sessions_changed') {
    return { ...state, revision: state.revision + 1 };
  }
  const current = recordingOf(state, action.deviceId);
  const next = reduceDevice(current, action);
  if (next === current) {
    return state;
  }
  const bumps = action.type === 'start_succeeded' || action.type === 'stop_succeeded';
  return {
    devices: { ...state.devices, [action.deviceId]: next },
    revision: bumps ? state.revision + 1 : state.revision,
  };
}

function reduceDevice(
  current: DeviceRecording,
  action: Exclude<RecorderAction, { type: 'sessions_changed' }>,
): DeviceRecording {
  switch (action.type) {
    case 'start_requested':
      if (current.phase !== 'idle') {
        return current;
      }
      return {
        phase: 'starting',
        startedAt: action.startedAt,
        ...(action.deviceName === undefined ? {} : { deviceName: action.deviceName }),
      };
    case 'start_succeeded':
      if (current.phase !== 'starting') {
        return current;
      }
      return {
        phase: 'recording',
        session: action.session,
        eventCount: action.session.eventCount,
        packetCount: action.session.packetCount,
        droppedCount: 0,
      };
    case 'start_failed':
      if (current.phase !== 'starting') {
        return current;
      }
      return { phase: 'idle', lastError: action.error };
    case 'events_appended':
      if (!isOpen(current) || current.session.id !== action.sessionId) {
        return current;
      }
      return {
        ...current,
        eventCount: current.eventCount + action.eventCount,
        packetCount: current.packetCount + action.packetCount,
      };
    case 'append_failed':
      if (!isOpen(current) || current.session.id !== action.sessionId) {
        return current;
      }
      return current.phase === 'recording'
        ? {
            ...current,
            droppedCount: current.droppedCount + action.droppedCount,
            lastError: action.error,
          }
        : { ...current, droppedCount: current.droppedCount + action.droppedCount };
    case 'stop_requested':
      if (current.phase !== 'recording') {
        return current;
      }
      return {
        phase: 'stopping',
        session: current.session,
        eventCount: current.eventCount,
        packetCount: current.packetCount,
        droppedCount: current.droppedCount,
      };
    case 'stop_succeeded':
      if (current.phase !== 'stopping') {
        return current;
      }
      return {
        phase: 'idle',
        lastSession: {
          ...current.session,
          endedAt: action.endedAt,
          eventCount: current.eventCount,
          packetCount: current.packetCount,
        },
      };
    case 'stop_failed':
      if (current.phase !== 'stopping') {
        return current;
      }
      return {
        phase: 'idle',
        lastSession: {
          ...current.session,
          eventCount: current.eventCount,
          packetCount: current.packetCount,
        },
        lastError: action.error,
      };
  }
}

function isOpen(
  recording: DeviceRecording,
): recording is Extract<DeviceRecording, { phase: 'recording' | 'stopping' }> {
  return recording.phase === 'recording' || recording.phase === 'stopping';
}

/** True while events for the device should be captured. */
export function isCapturing(recording: DeviceRecording): boolean {
  return recording.phase === 'starting' || recording.phase === 'recording';
}
