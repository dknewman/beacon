import type { BleSession, SessionEvent } from '@beacon/ble-contracts';

/**
 * Rebuilds a session and its events with their keys in a fixed order.
 *
 * JSON object order is not semantically meaningful, but a stable order makes
 * the export byte-reproducible: two exports of the same session are identical
 * files, and re-exporting a parsed document reproduces its input. That is what
 * lets a diff, a checksum or a signature over an export mean anything. The
 * runtime schemas rebuild objects in their own declaration order, so without
 * this a round trip would reorder keys.
 */
export function canonicalSession(session: BleSession): BleSession {
  return {
    id: session.id,
    deviceId: session.deviceId,
    ...(session.deviceName === undefined ? {} : { deviceName: session.deviceName }),
    startedAt: session.startedAt,
    ...(session.endedAt === undefined ? {} : { endedAt: session.endedAt }),
    packetCount: session.packetCount,
    eventCount: session.eventCount,
  };
}

export function canonicalEvent(event: SessionEvent): SessionEvent {
  const identity = {
    id: event.id,
    sessionId: event.sessionId,
    sequence: event.sequence,
    timestamp: event.timestamp,
  };
  switch (event.kind) {
    case 'connection':
      return { ...identity, kind: event.kind, state: event.state };
    case 'rssi':
      return { ...identity, kind: event.kind, rssi: event.rssi };
    case 'services_discovered':
      return {
        ...identity,
        kind: event.kind,
        serviceCount: event.serviceCount,
        characteristicCount: event.characteristicCount,
      };
    case 'subscription':
      return {
        ...identity,
        kind: event.kind,
        serviceUuid: event.serviceUuid,
        characteristicUuid: event.characteristicUuid,
        enabled: event.enabled,
      };
    case 'read':
    case 'write':
    case 'notification':
      return {
        ...identity,
        kind: event.kind,
        serviceUuid: event.serviceUuid,
        characteristicUuid: event.characteristicUuid,
        bytes: [...event.bytes],
      };
    case 'error':
      return {
        ...identity,
        kind: event.kind,
        error: {
          code: event.error.code,
          message: event.error.message,
          ...(event.error.nativeCode === undefined
            ? {}
            : { nativeCode: event.error.nativeCode }),
          ...(event.error.nativeDomain === undefined
            ? {}
            : { nativeDomain: event.error.nativeDomain }),
        },
      };
  }
}
