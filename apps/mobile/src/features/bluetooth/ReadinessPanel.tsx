import React from 'react';
import { StyleSheet, View } from 'react-native';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StatusRow } from '../../components/StatusRow';
import type { BluetoothAdapterStatus } from './adapter/bluetoothAdapterReducer';
import { describeBluetoothState } from './adapter/bluetoothStateLabels';
import { describePermissionState } from './permissions/permissionLabels';
import type { PermissionStatus } from './permissions/permissionReducer';
import type { BluetoothReadinessHandle } from './useBluetoothReadiness';

export interface ReadinessPanelProps {
  handle: BluetoothReadinessHandle;
}

/**
 * Adapter state, permission state, and the one action derived from both.
 * Lives at the top of the device list; while readiness is `ready` it collapses
 * to the two compact rows so the list gets the screen.
 */
export function ReadinessPanel({ handle }: ReadinessPanelProps): React.JSX.Element {
  const { adapter, permission, presentation, act } = handle;
  const adapterRow = presentAdapter(adapter.status);
  const permissionRow = presentPermission(permission.status);
  const action = presentation.action;

  return (
    <View style={styles.panel}>
      <StatusRow
        label="Status"
        value={presentation.title}
        detail={presentation.detail}
        testID="bluetooth-readiness"
      />

      {action === undefined ? null : (
        <PrimaryButton
          label={action.label}
          onPress={() => act(action.kind)}
          disabled={permission.status.phase === 'requesting'}
          testID="bluetooth-action"
        />
      )}

      <View style={styles.columns}>
        <View style={styles.column}>
          <StatusRow
            label="Bluetooth"
            value={adapterRow.value}
            detail={adapterRow.detail}
            testID="bluetooth-status"
          />
        </View>
        <View style={styles.column}>
          <StatusRow
            label="Permission"
            value={permissionRow.value}
            detail={permissionRow.detail}
            testID="permission-status"
          />
        </View>
      </View>
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

const styles = StyleSheet.create({
  panel: {
    gap: 12,
  },
  columns: {
    flexDirection: 'row',
    gap: 12,
  },
  column: {
    flex: 1,
  },
});
