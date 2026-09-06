import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StatusRow } from '../../components/StatusRow';
import { useTheme } from '../../theme/useTheme';
import type { BluetoothAdapterStatus } from './adapter/bluetoothAdapterReducer';
import { describeBluetoothState } from './adapter/bluetoothStateLabels';
import { useBluetoothAdapter } from './adapter/useBluetoothAdapter';
import { describePermissionState } from './permissions/permissionLabels';
import type { PermissionStatus } from './permissions/permissionReducer';
import { useBluetoothPermission } from './permissions/useBluetoothPermission';
import { deriveBluetoothReadiness } from './readiness/bluetoothReadiness';
import {
  presentReadiness,
  type ReadinessActionKind,
} from './readiness/readinessPresentation';
import { openAppSettings, openBluetoothSettings } from './settings/settingsGuidance';

/**
 * Home screen for M0/M1: adapter state, permission state, and one clear next
 * action derived from both. The device list replaces this as the home in M2;
 * the readiness card moves into it.
 */
export function BluetoothStatusScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const adapter = useBluetoothAdapter();
  const permission = useBluetoothPermission();

  const readiness = deriveBluetoothReadiness(adapter.status, permission.status);
  const presentation = presentReadiness(readiness);
  const adapterRow = presentAdapter(adapter.status);
  const permissionRow = presentPermission(permission.status);

  const onAction = useCallback(
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

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.background, paddingTop: insets.top + 24 },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: theme.colors.textPrimary }]}
      >
        Beacon
      </Text>

      <StatusRow
        label="Status"
        value={presentation.title}
        detail={presentation.detail}
        testID="bluetooth-readiness"
      />

      {presentation.action === undefined ? null : (
        <PrimaryButton
          label={presentation.action.label}
          onPress={() => onAction(presentation.action?.kind ?? 'retry')}
          disabled={permission.status.phase === 'requesting'}
          testID="bluetooth-action"
        />
      )}

      <StatusRow
        label="Bluetooth"
        value={adapterRow.value}
        detail={adapterRow.detail}
        testID="bluetooth-status"
      />

      <StatusRow
        label="Permission"
        value={permissionRow.value}
        detail={permissionRow.detail}
        testID="permission-status"
      />
    </View>
  );
}

interface RowPresentation {
  value: string;
  detail: string;
}

function presentAdapter(status: BluetoothAdapterStatus): RowPresentation {
  switch (status.phase) {
    case 'initializing':
      return {
        value: 'Checking',
        detail: 'Reading adapter state from the native module.',
      };
    case 'ready': {
      const label = describeBluetoothState(status.state);
      return { value: label.short, detail: label.description };
    }
    case 'failed':
      return { value: 'Error', detail: `${status.error.message} (${status.error.code})` };
  }
}

function presentPermission(status: PermissionStatus): RowPresentation {
  switch (status.phase) {
    case 'checking':
      return {
        value: 'Checking',
        detail: 'Reading permission state from the native module.',
      };
    case 'requesting':
      return { value: 'Asking', detail: 'Waiting for your answer to the system prompt.' };
    case 'ready': {
      const label = describePermissionState(status.state);
      return { value: label.short, detail: label.description };
    }
    case 'failed':
      return { value: 'Error', detail: `${status.error.message} (${status.error.code})` };
  }
}

/**
 * Opening a settings screen is best effort: the OS may refuse (unknown intent on
 * a customized ROM). The user still has the on-screen guidance text, so there is
 * nothing further to show.
 */
function ignoreSettingsFailure(): void {}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
});
