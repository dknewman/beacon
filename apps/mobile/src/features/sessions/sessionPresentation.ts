import {
  bytesToHex,
  toShortUuid,
  type BleSession,
  type SessionEventInput,
} from '@beacon/ble-contracts';
import type { DeviceRecording } from './sessionRecorderReducer';

/**
 * Text for the session screens (PROJECT.md 20): the timeline rows, the
 * Session row on the device detail and the history list. Pure, so every
 * string the screens show is covered by a unit test.
 */

/** "0 s", "12 s", "1 min 05 s", "1 h 02 min": the two largest units that apply. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours} h ${pad(minutes)} min`;
  }
  if (minutes > 0) {
    return `${minutes} min ${pad(seconds)} s`;
  }
  return `${seconds} s`;
}

/** Local date and time to the second, e.g. "7 Sep 2026, 10:31:02"; the raw text when unparseable. */
export function formatSessionStart(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  const month = MONTHS[date.getMonth()] ?? '';
  return `${date.getDate()} ${month} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

export interface SessionEventLabel {
  /** Upper-case kind, e.g. "CONNECTED", "NOTIFICATION". */
  title: string;
  detail?: string;
}

/** One timeline row; the time is formatted separately by the screen. */
export function describeSessionEvent(event: SessionEventInput): SessionEventLabel {
  switch (event.kind) {
    case 'connection':
      return { title: event.state.toUpperCase().replace(/_/g, ' ') };
    case 'rssi':
      return { title: 'RSSI', detail: `${event.rssi} dBm` };
    case 'services_discovered':
      return {
        title: 'SERVICES DISCOVERED',
        detail: `${count(event.serviceCount, 'service')}, ${count(
          event.characteristicCount,
          'characteristic',
        )}`,
      };
    case 'subscription':
      return {
        title: event.enabled ? 'SUBSCRIBED' : 'UNSUBSCRIBED',
        detail: labelPath(event.serviceUuid, event.characteristicUuid),
      };
    case 'read':
    case 'write':
    case 'notification':
      return {
        title: event.kind.toUpperCase(),
        detail: `${labelPath(event.serviceUuid, event.characteristicUuid)} · ${
          event.bytes.length === 0 ? '(empty)' : bytesToHex(event.bytes)
        }`,
      };
    case 'error':
      return { title: 'ERROR', detail: `${event.error.message} (${event.error.code})` };
  }
}

export interface RecordingLabel {
  value: string;
  detail: string;
}

/** The Session row on the device detail. */
export function describeRecording(recording: DeviceRecording): RecordingLabel {
  switch (recording.phase) {
    case 'idle': {
      const detail =
        recording.lastSession === undefined
          ? 'Press Start session to record what happens on this link.'
          : `Last session: ${count(recording.lastSession.eventCount, 'event')}, ${count(
              recording.lastSession.packetCount,
              'packet',
            )}.`;
      return { value: 'Not recording', detail: withError(detail, recording.lastError) };
    }
    case 'starting':
      return { value: 'Starting', detail: 'Creating the session.' };
    case 'recording': {
      const parts = [
        count(recording.eventCount, 'event'),
        count(recording.packetCount, 'packet'),
      ];
      if (recording.droppedCount > 0) {
        parts.push(`${recording.droppedCount} dropped`);
      }
      return {
        value: 'Recording',
        detail: withError(parts.join(' · '), recording.lastError),
      };
    }
    case 'stopping':
      return { value: 'Stopping', detail: 'Writing the last events.' };
  }
}

export interface SessionActionLabel {
  label: string;
  enabled: boolean;
  kind: 'start' | 'stop';
}

/** The one session control: start while idle, stop while recording. */
export function describeSessionAction(recording: DeviceRecording): SessionActionLabel {
  switch (recording.phase) {
    case 'idle':
      return { label: 'Start session', enabled: true, kind: 'start' };
    case 'starting':
      return { label: 'Starting…', enabled: false, kind: 'start' };
    case 'recording':
      return { label: 'Stop session', enabled: true, kind: 'stop' };
    case 'stopping':
      return { label: 'Stopping…', enabled: false, kind: 'stop' };
  }
}

export interface SessionLabel {
  title: string;
  subtitle: string;
}

/** A history row or a detail header: who, when, how long, how much. */
export function labelSession(session: BleSession): SessionLabel {
  const duration =
    session.endedAt === undefined
      ? 'Recording'
      : formatDuration(Date.parse(session.endedAt) - Date.parse(session.startedAt));
  return {
    title: session.deviceName ?? session.deviceId,
    subtitle: `${formatSessionStart(session.startedAt)} · ${duration} · ${count(
      session.packetCount,
      'packet',
    )}`,
  };
}

/** "180D / 2A37", falling back to the full UUID for vendor characteristics. */
export function labelPath(serviceUuid: string, characteristicUuid: string): string {
  return `${toShortUuid(serviceUuid) ?? serviceUuid} / ${
    toShortUuid(characteristicUuid) ?? characteristicUuid
  }`;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function withError(detail: string, error: string | undefined): string {
  return error === undefined ? detail : `${detail} ${error}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
