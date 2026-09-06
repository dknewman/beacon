import { Platform } from 'react-native';
import type { BluetoothReadiness } from './bluetoothReadiness';

export type ReadinessActionKind =
  'request_permission' | 'open_app_settings' | 'open_bluetooth_settings' | 'retry';

export interface ReadinessAction {
  kind: ReadinessActionKind;
  label: string;
}

export interface ReadinessPresentation {
  title: string;
  detail: string;
  action?: ReadinessAction;
}

/**
 * Human readable guidance for each readiness state, including the one action
 * that can move the user forward. Platform differences in the guidance text are
 * deliberate: iOS never re-prompts after a denial and has no deep link to the
 * Bluetooth toggle, whereas Android can re-prompt and can open Bluetooth settings.
 */
export function presentReadiness(readiness: BluetoothReadiness): ReadinessPresentation {
  switch (readiness.kind) {
    case 'checking':
      return { title: 'Checking', detail: 'Reading Bluetooth state and permission.' };
    case 'failed':
      return {
        title: 'Error',
        detail: `${readiness.error.message} (${readiness.error.code})`,
        action: { kind: 'retry', label: 'Retry' },
      };
    case 'unsupported':
      return {
        title: 'Unsupported',
        detail: 'This device has no Bluetooth Low Energy radio.',
      };
    case 'permission_required':
      return {
        title: 'Permission needed',
        detail:
          readiness.permission === 'denied'
            ? 'Bluetooth access was declined. Beacon needs it to find nearby devices.'
            : 'Beacon needs Bluetooth access to find nearby devices.',
        action: { kind: 'request_permission', label: 'Allow Bluetooth access' },
      };
    case 'permission_requesting':
      return {
        title: 'Asking for permission',
        detail: 'Answer the system prompt to continue.',
        action: { kind: 'request_permission', label: 'Allow Bluetooth access' },
      };
    case 'permission_blocked':
      return {
        title: 'Permission blocked',
        detail:
          Platform.OS === 'ios'
            ? 'Enable Bluetooth for Beacon in Settings. iOS does not ask again.'
            : 'Enable Nearby devices for Beacon in app settings.',
        action: { kind: 'open_app_settings', label: 'Open Settings' },
      };
    case 'powered_off':
      return {
        title: 'Bluetooth is off',
        detail:
          Platform.OS === 'ios'
            ? 'Turn on Bluetooth in Control Center or Settings.'
            : 'Turn on Bluetooth to scan for devices.',
        action: { kind: 'open_bluetooth_settings', label: 'Open Bluetooth settings' },
      };
    case 'unavailable':
      return {
        title: readiness.state === 'resetting' ? 'Restarting' : 'Waiting',
        detail:
          readiness.state === 'resetting'
            ? 'The Bluetooth system is restarting.'
            : 'Waiting for the Bluetooth adapter to report its state.',
      };
    case 'ready':
      return {
        title: 'Ready',
        detail: 'Bluetooth is on and Beacon has permission to scan.',
      };
  }
}
