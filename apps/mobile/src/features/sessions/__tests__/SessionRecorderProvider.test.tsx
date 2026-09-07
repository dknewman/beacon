import React, { type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { SessionEventInput } from '@beacon/ble-contracts';
import { ActivityBusProvider } from '../../activity/ActivityBusProvider';
import { createActivityBus, type ActivityBus } from '../../activity/activityBus';
import { InMemorySessionRepository } from '../InMemorySessionRepository';
import type { SessionRepository } from '../SessionRepository';
import { SessionRecorderProvider, useSessionRecorder } from '../SessionRecorderProvider';

const HR = '0000180D-0000-1000-8000-00805F9B34FB';
const HRM = '00002A37-0000-1000-8000-00805F9B34FB';

let tick = 0;
const now = () => `2026-01-01T00:00:${String(tick++).padStart(2, '0')}.000Z`;

async function setup(
  options: { repository?: SessionRepository; bus?: ActivityBus } = {},
) {
  const repository = options.repository ?? new InMemorySessionRepository();
  const bus = options.bus ?? createActivityBus();
  const errors: string[] = [];
  const wrapper = ({ children }: PropsWithChildren) => (
    <ActivityBusProvider bus={bus}>
      <SessionRecorderProvider
        repository={repository}
        flushIntervalMs={5}
        maxBufferedEvents={3}
        now={now}
        onError={context => errors.push(context)}
      >
        {children}
      </SessionRecorderProvider>
    </ActivityBusProvider>
  );
  const hook = await renderHook(() => useSessionRecorder(), { wrapper });
  return { repository, bus, errors, ...hook };
}

const rssi = (value: number): SessionEventInput => ({
  kind: 'rssi',
  rssi: value,
  timestamp: now(),
});

const notification = (): SessionEventInput => ({
  kind: 'notification',
  serviceUuid: HR,
  characteristicUuid: HRM,
  bytes: [0, 72],
  timestamp: now(),
});

beforeEach(() => {
  tick = 0;
});

describe('SessionRecorderProvider', () => {
  it('starts a session, persists published activity in order, and stops it', async () => {
    const repository = new InMemorySessionRepository();
    const createSession = repository.createSession.bind(repository);
    let releaseCreate: () => void = () => undefined;
    jest.spyOn(repository, 'createSession').mockImplementation(async input => {
      await new Promise<void>(resolve => {
        releaseCreate = resolve;
      });
      return createSession(input);
    });
    const { result, bus } = await setup({ repository });
    expect(result.current.recordingOf('dev').phase).toBe('idle');

    await act(async () => {
      result.current.startSession('dev', 'Polar H10');
    });
    expect(result.current.recordingOf('dev').phase).toBe('starting');
    // Published before the row exists: must still be captured.
    await act(async () => {
      bus.publish({ deviceId: 'dev', ...rssi(-50) });
    });
    await act(async () => {
      releaseCreate();
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev').phase).toBe('recording'),
    );

    await act(async () => {
      bus.publish({ deviceId: 'dev', ...notification() });
      bus.publish({ deviceId: 'other', ...rssi(-90) });
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev')).toMatchObject({
        phase: 'recording',
        eventCount: 2,
        packetCount: 1,
      }),
    );

    await act(async () => {
      result.current.stopSession('dev');
    });
    await waitFor(() => expect(result.current.recordingOf('dev').phase).toBe('idle'));

    const sessions = await repository.listSessions();
    expect(sessions).toHaveLength(1);
    const [session] = sessions;
    expect(session).toMatchObject({
      deviceId: 'dev',
      deviceName: 'Polar H10',
      eventCount: 2,
      packetCount: 1,
    });
    expect(session?.endedAt).toBeDefined();
    const events = await repository.listEvents(session?.id ?? '');
    expect(events.map(event => [event.sequence, event.kind])).toEqual([
      [1, 'rssi'],
      [2, 'notification'],
    ]);
    expect(result.current.recordingOf('dev')).toMatchObject({
      phase: 'idle',
      lastSession: { id: session?.id, eventCount: 2, packetCount: 1 },
    });
    expect(result.current.state.revision).toBe(2);
  });

  it('writes a full buffer without waiting for the timer', async () => {
    const repository = new InMemorySessionRepository();
    const appends: number[] = [];
    const spy = jest.spyOn(repository, 'appendEvents');
    spy.mockImplementation((sessionId, events) => {
      appends.push(events.length);
      return InMemorySessionRepository.prototype.appendEvents.call(
        repository,
        sessionId,
        events,
      );
    });
    const { result, bus } = await setup({ repository });

    await act(async () => {
      result.current.startSession('dev');
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev').phase).toBe('recording'),
    );
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        bus.publish({ deviceId: 'dev', ...rssi(-40 - index) });
      }
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev')).toMatchObject({ eventCount: 5 }),
    );
    expect(appends).toEqual([3, 2]);
  });

  it('ignores activity while idle and after stop was requested', async () => {
    const { result, repository, bus } = await setup();
    await act(async () => {
      bus.publish({ deviceId: 'dev', ...rssi(-1) });
      result.current.startSession('dev');
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev').phase).toBe('recording'),
    );
    await act(async () => {
      result.current.stopSession('dev');
      bus.publish({ deviceId: 'dev', ...rssi(-2) });
    });
    await waitFor(() => expect(result.current.recordingOf('dev').phase).toBe('idle'));

    const [session] = await repository.listSessions();
    expect(session?.eventCount).toBe(0);
  });

  it('reports a failed start and returns to idle', async () => {
    const repository = new InMemorySessionRepository();
    jest.spyOn(repository, 'createSession').mockRejectedValue(new Error('disk full'));
    const { result, errors } = await setup({ repository });

    await act(async () => {
      result.current.startSession('dev');
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev')).toEqual({
        phase: 'idle',
        lastError: 'disk full',
      }),
    );
    expect(errors).toEqual(['createSession']);
  });

  it('keeps recording after a failed append and counts the dropped events', async () => {
    const repository = new InMemorySessionRepository();
    const original = repository.appendEvents.bind(repository);
    let fail = true;
    jest.spyOn(repository, 'appendEvents').mockImplementation((sessionId, events) => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error('database is locked'));
      }
      return original(sessionId, events);
    });
    const { result, bus, errors } = await setup({ repository });

    await act(async () => {
      result.current.startSession('dev');
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev').phase).toBe('recording'),
    );
    await act(async () => {
      bus.publish({ deviceId: 'dev', ...rssi(-1) });
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev')).toMatchObject({
        phase: 'recording',
        droppedCount: 1,
        lastError: 'database is locked',
      }),
    );
    await act(async () => {
      bus.publish({ deviceId: 'dev', ...rssi(-2) });
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev')).toMatchObject({
        eventCount: 1,
        droppedCount: 1,
      }),
    );
    expect(errors).toEqual(['appendEvents']);
  });

  it('closes sessions an earlier run left open when it mounts', async () => {
    const repository = new InMemorySessionRepository();
    const stale = await repository.createSession({
      deviceId: 'dev',
      startedAt: '2025-12-31T00:00:00.000Z',
    });
    const { result } = await setup({ repository });

    await waitFor(() => expect(result.current.state.revision).toBe(1));
    expect((await repository.getSession(stale.id))?.endedAt).toBe(
      '2025-12-31T00:00:00.000Z',
    );
  });

  it('recovers only on mount, never closing the session it is recording', async () => {
    const repository = new InMemorySessionRepository();
    const endSession = jest.spyOn(repository, 'endSession');
    // Default callbacks: their identity must not change between renders.
    const wrapper = ({ children }: PropsWithChildren) => (
      <ActivityBusProvider bus={bus}>
        <SessionRecorderProvider repository={repository} flushIntervalMs={5}>
          {children}
        </SessionRecorderProvider>
      </ActivityBusProvider>
    );
    const bus = createActivityBus();
    const { result } = await renderHook(() => useSessionRecorder(), { wrapper });

    await act(async () => {
      result.current.startSession('dev');
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev').phase).toBe('recording'),
    );
    // Each acknowledged append re-renders the provider.
    await act(async () => {
      bus.publish({ deviceId: 'dev', ...rssi(-40) });
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev')).toMatchObject({ eventCount: 1 }),
    );
    await act(async () => {
      bus.publish({ deviceId: 'dev', ...rssi(-41) });
    });
    await waitFor(() =>
      expect(result.current.recordingOf('dev')).toMatchObject({ eventCount: 2 }),
    );

    expect(endSession).not.toHaveBeenCalled();
    const [session] = await repository.listSessions();
    expect(session?.endedAt).toBeUndefined();
  });

  it('records for two devices independently', async () => {
    const { result, repository, bus } = await setup();
    await act(async () => {
      result.current.startSession('a');
      result.current.startSession('b');
    });
    await waitFor(() => {
      expect(result.current.recordingOf('a').phase).toBe('recording');
      expect(result.current.recordingOf('b').phase).toBe('recording');
    });
    await act(async () => {
      bus.publish({ deviceId: 'a', ...rssi(-1) });
      bus.publish({ deviceId: 'b', ...rssi(-2) });
      bus.publish({ deviceId: 'b', ...rssi(-3) });
    });
    await waitFor(() => {
      expect(result.current.recordingOf('a')).toMatchObject({ eventCount: 1 });
      expect(result.current.recordingOf('b')).toMatchObject({ eventCount: 2 });
    });
    const sessions = await repository.listSessions();
    expect(
      sessions.map(session => [session.deviceId, session.eventCount]).sort(),
    ).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('throws when used outside its provider', async () => {
    await expect(renderHook(() => useSessionRecorder())).rejects.toThrow(
      'useSessionRecorder must be used within a SessionRecorderProvider',
    );
  });
});
