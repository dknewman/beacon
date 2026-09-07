import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type PropsWithChildren,
} from 'react';
import { isPacketEvent, type SessionEventInput } from '@beacon/ble-contracts';
import { useActivityBus } from '../activity/ActivityBusProvider';
import { recoverOpenSessions } from './recoverOpenSessions';
import type { SessionRepository } from './SessionRepository';
import {
  initialRecorderState,
  isCapturing,
  recordingOf,
  sessionRecorderReducer,
  type DeviceRecording,
  type RecorderState,
} from './sessionRecorderReducer';

export interface SessionRecorder {
  state: RecorderState;
  recordingOf: (deviceId: string) => DeviceRecording;
  /** Opens a session for the device; ignored unless the device is idle. */
  startSession: (deviceId: string, deviceName?: string) => void;
  /** Writes what is buffered, then closes the session; ignored unless recording. */
  stopSession: (deviceId: string) => void;
  /** The store, for screens that list and read sessions. */
  repository: SessionRepository;
  /** Tells lists that stored sessions changed outside the recorder (a delete). */
  notifySessionsChanged: () => void;
}

export interface SessionRecorderProviderProps {
  repository: SessionRepository;
  /** How long captured events wait before one append; the write cadence. */
  flushIntervalMs?: number;
  /** A buffer this long is written without waiting for the timer. */
  maxBufferedEvents?: number;
  /** Clock, replaceable in tests. */
  now?: () => string;
  /** Called when the store rejects an operation; the state carries the message too. */
  onError?: (context: string, error: unknown) => void;
}

/**
 * Four writes per second keeps a 100 Hz stream to a few dozen rows per
 * transaction, well inside what SQLite handles on a phone, while a stop still
 * feels immediate.
 */
export const DEFAULT_SESSION_FLUSH_INTERVAL_MS = 250;
export const DEFAULT_MAX_BUFFERED_EVENTS = 200;

/**
 * Module-level defaults so their identity is stable across renders: the
 * effects and callbacks below depend on them, and a fresh function per
 * render would re-run recovery on every state change, closing the very
 * session being recorded.
 */
const isoNow = (): string => new Date().toISOString();
const ignoreErrors = (_context: string, _error: unknown): void => undefined;

const SessionRecorderContext = createContext<SessionRecorder | undefined>(undefined);

/**
 * The Session Manager (PROJECT.md 20, 29): listens to the activity bus and
 * persists, per device, everything between Start Session and Stop Session.
 *
 * Rules:
 * - Capture begins at the start request, so nothing is lost while the row is
 *   being created; events wait in the buffer until the session id exists.
 * - Appends for one session run one after another so sequence numbers match
 *   the order things happened. A failed append drops that batch, counts it,
 *   and keeps the session open; the next batch tries again.
 * - Stop writes the remaining buffer first, then closes the row.
 * - Sessions left open by an earlier run are closed on mount.
 */
export function SessionRecorderProvider({
  repository,
  flushIntervalMs = DEFAULT_SESSION_FLUSH_INTERVAL_MS,
  maxBufferedEvents = DEFAULT_MAX_BUFFERED_EVENTS,
  now = isoNow,
  onError = ignoreErrors,
  children,
}: PropsWithChildren<SessionRecorderProviderProps>): React.JSX.Element {
  const bus = useActivityBus();
  const [state, dispatch] = useReducer(sessionRecorderReducer, initialRecorderState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const buffers = useRef(new Map<string, SessionEventInput[]>());
  const chains = useRef(new Map<string, Promise<void>>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  /** Runs store operations for one device strictly one after another. */
  const enqueue = useCallback(
    (deviceId: string, work: () => Promise<void>) => {
      const previous = chains.current.get(deviceId) ?? Promise.resolve();
      chains.current.set(
        deviceId,
        previous.then(work, work).catch((error: unknown) => onError('queue', error)),
      );
    },
    [onError],
  );

  const flushDevice = useCallback(
    (deviceId: string) => {
      const recording = recordingOf(stateRef.current, deviceId);
      const events = buffers.current.get(deviceId);
      if (recording.phase === 'starting' || events === undefined || events.length === 0) {
        return;
      }
      if (recording.phase === 'idle') {
        buffers.current.delete(deviceId);
        return;
      }
      buffers.current.set(deviceId, []);
      const sessionId = recording.session.id;
      enqueue(deviceId, () =>
        repository.appendEvents(sessionId, events).then(
          () => {
            if (mounted.current) {
              dispatch({
                type: 'events_appended',
                deviceId,
                sessionId,
                eventCount: events.length,
                packetCount: events.filter(isPacketEvent).length,
              });
            }
          },
          (error: unknown) => {
            onError('appendEvents', error);
            if (mounted.current) {
              dispatch({
                type: 'append_failed',
                deviceId,
                sessionId,
                droppedCount: events.length,
                error: messageOf(error),
              });
            }
          },
        ),
      );
    },
    [enqueue, onError, repository],
  );

  const flushAll = useCallback(() => {
    flushTimer.current = undefined;
    for (const deviceId of [...buffers.current.keys()]) {
      flushDevice(deviceId);
    }
  }, [flushDevice]);

  const scheduleFlush = useCallback(() => {
    flushTimer.current ??= setTimeout(flushAll, flushIntervalMs);
  }, [flushAll, flushIntervalMs]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = bus.subscribe(activity => {
      if (!isCapturing(recordingOf(stateRef.current, activity.deviceId))) {
        return;
      }
      const { deviceId, ...event } = activity;
      const buffer = buffers.current.get(deviceId) ?? [];
      buffer.push(event);
      buffers.current.set(deviceId, buffer);
      if (buffer.length >= maxBufferedEvents) {
        flushDevice(deviceId);
      } else {
        scheduleFlush();
      }
    });
    const pendingBuffers = buffers.current;
    return () => {
      mounted.current = false;
      unsubscribe();
      if (flushTimer.current !== undefined) {
        clearTimeout(flushTimer.current);
        flushTimer.current = undefined;
      }
      pendingBuffers.clear();
    };
  }, [bus, flushDevice, maxBufferedEvents, scheduleFlush]);

  useEffect(() => {
    recoverOpenSessions(repository).then(
      closed => {
        if (mounted.current && closed.length > 0) {
          dispatch({ type: 'sessions_changed' });
        }
      },
      (error: unknown) => onError('recoverOpenSessions', error),
    );
  }, [onError, repository]);

  const startSession = useCallback(
    (deviceId: string, deviceName?: string) => {
      if (recordingOf(stateRef.current, deviceId).phase !== 'idle') {
        return;
      }
      const startedAt = now();
      dispatch({
        type: 'start_requested',
        deviceId,
        startedAt,
        ...(deviceName === undefined ? {} : { deviceName }),
      });
      buffers.current.set(deviceId, []);
      enqueue(deviceId, () =>
        repository
          .createSession({
            deviceId,
            startedAt,
            ...(deviceName === undefined ? {} : { deviceName }),
          })
          .then(
            session => {
              if (!mounted.current) {
                return;
              }
              dispatch({ type: 'start_succeeded', deviceId, session });
              if ((buffers.current.get(deviceId)?.length ?? 0) > 0) {
                scheduleFlush();
              }
            },
            (error: unknown) => {
              onError('createSession', error);
              buffers.current.delete(deviceId);
              if (mounted.current) {
                dispatch({ type: 'start_failed', deviceId, error: messageOf(error) });
              }
            },
          ),
      );
    },
    [enqueue, now, onError, repository, scheduleFlush],
  );

  const stopSession = useCallback(
    (deviceId: string) => {
      const recording = recordingOf(stateRef.current, deviceId);
      if (recording.phase !== 'recording') {
        return;
      }
      const sessionId = recording.session.id;
      flushDevice(deviceId);
      buffers.current.delete(deviceId);
      dispatch({ type: 'stop_requested', deviceId });
      const endedAt = now();
      enqueue(deviceId, () =>
        repository.endSession(sessionId, endedAt).then(
          () => {
            if (mounted.current) {
              dispatch({ type: 'stop_succeeded', deviceId, endedAt });
            }
          },
          (error: unknown) => {
            onError('endSession', error);
            if (mounted.current) {
              dispatch({ type: 'stop_failed', deviceId, error: messageOf(error) });
            }
          },
        ),
      );
    },
    [enqueue, flushDevice, now, onError, repository],
  );

  const notifySessionsChanged = useCallback(() => {
    dispatch({ type: 'sessions_changed' });
  }, []);

  const value = useMemo<SessionRecorder>(
    () => ({
      state,
      recordingOf: deviceId => recordingOf(state, deviceId),
      startSession,
      stopSession,
      repository,
      notifySessionsChanged,
    }),
    [state, startSession, stopSession, repository, notifySessionsChanged],
  );

  return (
    <SessionRecorderContext.Provider value={value}>
      {children}
    </SessionRecorderContext.Provider>
  );
}

export function useSessionRecorder(): SessionRecorder {
  const value = useContext(SessionRecorderContext);
  if (value === undefined) {
    throw new Error('useSessionRecorder must be used within a SessionRecorderProvider');
  }
  return value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
