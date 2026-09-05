import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusRow } from '../../components/StatusRow';
import { useTheme } from '../../theme/useTheme';
import { describeBluetoothState } from './adapter/bluetoothStateLabels';
import { useBluetoothAdapter } from './adapter/useBluetoothAdapter';
import type { BluetoothAdapterStatus } from './adapter/bluetoothAdapterReducer';

/**
 * M0 home screen: proves the Swift/Kotlin bridge is callable by rendering the
 * live adapter state. Scanning and device lists arrive in M2.
 */
export function BluetoothStatusScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { status, retry } = useBluetoothAdapter();
  const presentation = presentStatus(status);

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
        label="Bluetooth"
        value={presentation.value}
        detail={presentation.detail}
        testID="bluetooth-status"
      />

      {status.phase === 'failed' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry reading Bluetooth state"
          onPress={retry}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.colors.accent, opacity: pressed ? 0.7 : 1 },
          ]}
          testID="bluetooth-retry"
        >
          <Text style={[styles.buttonLabel, { color: theme.colors.onAccent }]}>
            Retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface StatusPresentation {
  value: string;
  detail: string;
}

function presentStatus(status: BluetoothAdapterStatus): StatusPresentation {
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
      return {
        value: 'Error',
        detail: `${status.error.message} (${status.error.code})`,
      };
  }
}

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
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
});
