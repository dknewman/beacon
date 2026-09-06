import type { DeviceConnection } from './connectionReducer';

export interface ConnectionLabel {
  short: string;
  description: string;
}

/** Text for every connection state; the error, when any, is part of the text. */
export function describeConnection(connection: DeviceConnection): ConnectionLabel {
  switch (connection.state) {
    case 'disconnected':
      return connection.lastError === undefined
        ? { short: 'Disconnected', description: 'Not connected to this device.' }
        : {
            short: 'Disconnected',
            description: `Link ended: ${connection.lastError.message} (${connection.lastError.code}).`,
          };
    case 'connecting':
      return {
        short: 'Connecting',
        description: 'Waiting for the device to accept the link.',
      };
    case 'connected':
      return { short: 'Connected', description: 'Link established. Preparing services…' };
    case 'discovering_services':
      return { short: 'Discovering services', description: 'Reading the GATT table.' };
    case 'ready':
      return { short: 'Ready', description: 'Connected and services discovered.' };
    case 'disconnecting':
      return { short: 'Disconnecting', description: 'Closing the link.' };
    case 'failed':
      return {
        short: 'Failed',
        description:
          connection.lastError === undefined
            ? 'The connection failed.'
            : `${connection.lastError.message} (${connection.lastError.code})`,
      };
  }
}

export type ConnectionActionKind = 'connect' | 'cancel' | 'disconnect';

export interface ConnectionActionPresentation {
  kind: ConnectionActionKind;
  label: string;
  /** Disabled while a transition native owns is in flight. */
  enabled: boolean;
}

/** The single connection button for every state. */
export function presentConnectionAction(
  connection: DeviceConnection,
): ConnectionActionPresentation {
  switch (connection.state) {
    case 'disconnected':
      return { kind: 'connect', label: 'Connect', enabled: true };
    case 'failed':
      return { kind: 'connect', label: 'Try again', enabled: true };
    case 'connecting':
      return { kind: 'cancel', label: 'Cancel', enabled: true };
    case 'connected':
    case 'discovering_services':
    case 'ready':
      return { kind: 'disconnect', label: 'Disconnect', enabled: true };
    case 'disconnecting':
      return { kind: 'disconnect', label: 'Disconnecting…', enabled: false };
  }
}
