import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeServiceUuid, type CharacteristicProperty } from '@beacon/ble-contracts';
import type {
  CharacteristicDetailRoute,
  RootNavigation,
} from '../../app/navigation/RootNavigator';
import { StatusRow } from '../../components/StatusRow';
import { useTheme } from '../../theme/useTheme';
import { useConnections } from '../connection/ConnectionProvider';
import { describeProperties, labelCharacteristic } from './gattLabels';
import { useGatt } from './GattProvider';

/**
 * Characteristic detail (PROJECT.md 15): identity and properties from the
 * discovered table. Reads, writes and subscriptions land here in M5 and M6;
 * until then the screen says so rather than showing dead controls.
 */
export function CharacteristicDetailScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<CharacteristicDetailRoute>();
  const gatt = useGatt();
  const connection = useConnections().connectionOf(params.deviceId);
  const status = gatt.statusOf(params.deviceId);

  const service =
    status.phase === 'ready'
      ? status.services.find(candidate => candidate.uuid === params.serviceUuid)
      : undefined;
  const characteristic = service?.characteristics.find(
    candidate => candidate.uuid === params.characteristicUuid,
  );
  const serviceLabel = describeServiceUuid(params.serviceUuid);
  const label =
    characteristic === undefined ? undefined : labelCharacteristic(characteristic);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
      ]}
      style={{ backgroundColor: theme.colors.background }}
      testID="characteristic-detail"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to services"
        hitSlop={12}
        onPress={() => navigation.goBack()}
        style={styles.back}
        testID="characteristic-back"
      >
        <Text style={[styles.backLabel, { color: theme.colors.accent }]}>‹ Services</Text>
      </Pressable>

      <Text
        style={[styles.code, { color: theme.colors.textSecondary }]}
        testID="characteristic-code"
      >
        {label?.code ?? params.characteristicUuid}
      </Text>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: theme.colors.textPrimary }]}
        testID="characteristic-title"
      >
        {label?.title ?? 'Characteristic'}
      </Text>

      <StatusRow
        label="Service"
        value={serviceLabel.name ?? serviceLabel.display}
        detail={serviceLabel.name === undefined ? undefined : serviceLabel.display}
        testID="characteristic-service"
      />

      {characteristic === undefined ? (
        <StatusRow
          label="Properties"
          value={connection.state === 'ready' ? 'Unavailable' : 'Not connected'}
          detail={
            connection.state === 'ready'
              ? 'This characteristic is not in the discovered table.'
              : 'Connect to the device to inspect this characteristic.'
          }
          testID="characteristic-properties"
        />
      ) : (
        <StatusRow
          label="Properties"
          value={describeProperties(characteristic.properties)}
          detail={describeCapabilities(characteristic.properties)}
          testID="characteristic-properties"
        />
      )}

      <StatusRow
        label="Value"
        value="Not read yet"
        detail="Reading, writing and subscribing arrive with the next milestones."
        testID="characteristic-value"
      />
    </ScrollView>
  );
}

function describeCapabilities(properties: CharacteristicProperty[]): string {
  const can: string[] = [];
  if (properties.includes('read')) {
    can.push('can be read');
  }
  if (properties.includes('write') || properties.includes('write_without_response')) {
    can.push('accepts writes');
  }
  if (properties.includes('notify') || properties.includes('indicate')) {
    can.push('pushes updates');
  }
  return can.length === 0
    ? 'No operations are advertised.'
    : `This characteristic ${can.join(', ')}.`;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    gap: 12,
  },
  back: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  backLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  code: {
    fontSize: 13,
    fontFamily: 'monospace',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginTop: -8,
  },
});
