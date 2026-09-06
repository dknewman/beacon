import React, { useCallback, useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GattCharacteristic, GattService } from '@beacon/ble-contracts';
import type {
  GattInspectorRoute,
  RootNavigation,
} from '../../app/navigation/RootNavigator';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StatusRow } from '../../components/StatusRow';
import { useTheme } from '../../theme/useTheme';
import { useConnections } from '../connection/ConnectionProvider';
import { describeProperties, labelCharacteristic, labelService } from './gattLabels';
import { useGatt } from './GattProvider';

/**
 * GATT inspector (PROJECT.md 15): every service with its characteristics and
 * their properties, labelled from the known UUID registry. Discovery runs on
 * first visit; the table is dropped with the link.
 */
export function GattInspectorScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<GattInspectorRoute>();
  const gatt = useGatt();
  const connection = useConnections().connectionOf(params.deviceId);
  const status = gatt.statusOf(params.deviceId);
  const isReady = connection.state === 'ready';

  useEffect(() => {
    if (isReady && status.phase === 'idle') {
      gatt.discover(params.deviceId);
    }
  }, [isReady, status.phase, gatt, params.deviceId]);

  const openCharacteristic = useCallback(
    (characteristic: GattCharacteristic) =>
      navigation.navigate('CharacteristicDetail', {
        deviceId: params.deviceId,
        serviceUuid: characteristic.serviceUuid,
        characteristicUuid: characteristic.uuid,
      }),
    [navigation, params.deviceId],
  );

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
      ]}
      style={{ backgroundColor: theme.colors.background }}
      testID="gatt-inspector"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to device"
        hitSlop={12}
        onPress={() => navigation.goBack()}
        style={styles.back}
        testID="gatt-back"
      >
        <Text style={[styles.backLabel, { color: theme.colors.accent }]}>‹ Device</Text>
      </Pressable>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: theme.colors.textPrimary }]}
      >
        GATT Services
      </Text>

      {!isReady ? (
        <StatusRow
          label="Status"
          value="Not connected"
          detail="Connect to the device to read its services."
          testID="gatt-status"
        />
      ) : status.phase === 'idle' || status.phase === 'discovering' ? (
        <StatusRow
          label="Status"
          value="Discovering"
          detail="Reading the service table from the device."
          testID="gatt-status"
        />
      ) : status.phase === 'failed' ? (
        <>
          <StatusRow
            label="Status"
            value="Failed"
            detail={`${status.error.message} (${status.error.code})`}
            testID="gatt-status"
          />
          <PrimaryButton
            label="Try again"
            onPress={() => gatt.discover(params.deviceId)}
            testID="gatt-retry"
          />
        </>
      ) : status.services.length === 0 ? (
        <StatusRow
          label="Status"
          value="No services"
          detail="The device reported an empty service table."
          testID="gatt-status"
        />
      ) : (
        status.services.map(service => (
          <ServiceCard key={service.uuid} service={service} onOpen={openCharacteristic} />
        ))
      )}
    </ScrollView>
  );
}

interface ServiceCardProps {
  service: GattService;
  onOpen: (characteristic: GattCharacteristic) => void;
}

function ServiceCard({ service, onOpen }: ServiceCardProps): React.JSX.Element {
  const theme = useTheme();
  const label = labelService(service);
  return (
    <View
      style={[styles.card, { backgroundColor: theme.colors.surface }]}
      testID={`service-${label.code}`}
    >
      <Text
        style={[styles.code, { color: theme.colors.textSecondary }]}
        testID={`service-${label.code}-code`}
      >
        {label.code}
        {service.primary ? '' : ' · secondary'}
      </Text>
      <Text
        accessibilityRole="header"
        style={[styles.name, { color: theme.colors.textPrimary }]}
        testID={`service-${label.code}-name`}
      >
        {label.title}
      </Text>
      {service.characteristics.length === 0 ? (
        <Text style={[styles.meta, { color: theme.colors.textSecondary }]}>
          No characteristics
        </Text>
      ) : (
        service.characteristics.map(characteristic => (
          <CharacteristicRow
            key={characteristic.uuid}
            characteristic={characteristic}
            onOpen={onOpen}
          />
        ))
      )}
    </View>
  );
}

interface CharacteristicRowProps {
  characteristic: GattCharacteristic;
  onOpen: (characteristic: GattCharacteristic) => void;
}

function CharacteristicRow({
  characteristic,
  onOpen,
}: CharacteristicRowProps): React.JSX.Element {
  const theme = useTheme();
  const label = labelCharacteristic(characteristic);
  const properties = describeProperties(characteristic.properties);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label.title} ${label.code}, ${properties}`}
      accessibilityHint="Opens the characteristic detail"
      onPress={() => onOpen(characteristic)}
      style={({ pressed }) => [
        styles.characteristic,
        { borderTopColor: theme.colors.background, opacity: pressed ? 0.7 : 1 },
      ]}
      testID={`characteristic-${label.code}`}
    >
      <View style={styles.characteristicHeadline}>
        <Text style={[styles.characteristicName, { color: theme.colors.textPrimary }]}>
          {label.title}
        </Text>
        <Text style={[styles.code, { color: theme.colors.textSecondary }]}>
          {label.code}
        </Text>
      </View>
      <Text
        style={[styles.meta, { color: theme.colors.textSecondary }]}
        testID={`characteristic-${label.code}-properties`}
      >
        {properties}
      </Text>
    </Pressable>
  );
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
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  card: {
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  code: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
  },
  characteristic: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  characteristicHeadline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  characteristicName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    fontSize: 13,
  },
});
