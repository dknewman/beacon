import { useCallback } from 'react';
import type { BluetoothAdapterHandle } from './adapter/useBluetoothAdapter';
import { useBluetoothAdapter } from './adapter/useBluetoothAdapter';
import type { BluetoothPermissionHandle } from './permissions/useBluetoothPermission';
import { useBluetoothPermission } from './permissions/useBluetoothPermission';
import {
  deriveBluetoothReadiness,
  type BluetoothReadiness,
} from './readiness/bluetoothReadiness';
import {
  presentReadiness,
  type ReadinessActionKind,
  type ReadinessPresentation,
} from './readiness/readinessPresentation';
import { openAppSettings, openBluetoothSettings } from './settings/settingsGuidance';

export interface BluetoothReadinessHandle {
  adapter: BluetoothAdapterHandle;
  permission: BluetoothPermissionHandle;
  readiness: BluetoothReadiness;
  presentation: ReadinessPresentation;
  /** Performs the single next action the presentation offers. */
  act: (kind: ReadinessActionKind) => void;
}

/**
 * Combines the adapter and permission machines into one readiness value plus
 * the action that can move the user forward. Screens consume this instead of
 * wiring the two hooks themselves.
 */
export function useBluetoothReadiness(): BluetoothReadinessHandle {
  const adapter = useBluetoothAdapter();
  const permission = useBluetoothPermission();
  const readiness = deriveBluetoothReadiness(adapter.status, permission.status);
  const presentation = presentReadiness(readiness);

  const act = useCallback(
    (kind: ReadinessActionKind) => {
      switch (kind) {
        case 'request_permission':
          permission.request();
          break;
        case 'open_app_settings':
          openAppSettings().catch(ignoreSettingsFailure);
          break;
        case 'open_bluetooth_settings':
          openBluetoothSettings().catch(ignoreSettingsFailure);
          break;
        case 'retry':
          adapter.retry();
          permission.retry();
          break;
      }
    },
    [adapter, permission],
  );

  return { adapter, permission, readiness, presentation, act };
}

/**
 * Opening a settings screen is best effort: the OS may refuse (unknown intent on
 * a customized ROM). The user still has the on-screen guidance text, so there is
 * nothing further to show.
 */
function ignoreSettingsFailure(): void {}
