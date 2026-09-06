import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootNavigation } from '../../app/navigation/RootNavigator';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useTheme } from '../../theme/useTheme';
import { ReadinessPanel } from '../bluetooth/ReadinessPanel';
import { useConnections } from '../connection/ConnectionProvider';
import type { CachedDevice } from './deviceCache';
import { applyDeviceFilters, emptyDeviceFilters, isFiltering } from './deviceFilters';
import { DeviceRow } from './DeviceRow';
import { FilterBar } from './FilterBar';
import { presentScanButton, presentScanSummary } from './scanPresentation';
import { useBluetoothSession } from './ScanProvider';

/**
 * Home screen (PROJECT.md 10): readiness at the top, one scan control,
 * filters, and the deduplicated device list sorted by signal strength.
 * Tapping a row opens the device detail; the scan keeps running underneath.
 */
export function DeviceListScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const { bluetooth, scan } = useBluetoothSession();
  const { connections } = useConnections();
  const [filters, setFilters] = useState(emptyDeviceFilters);

  const devices = useMemo(
    () => applyDeviceFilters(scan.devices, filters),
    [scan.devices, filters],
  );
  const button = presentScanButton(bluetooth.readiness, scan.status);
  const summary = presentScanSummary(
    scan.status,
    devices.length,
    scan.seenCount,
    isFiltering(filters),
  );

  const onScanPress = useCallback(() => {
    if (button.intent === 'start') {
      scan.start();
    } else if (button.intent === 'stop') {
      scan.stop();
    }
  }, [button.intent, scan]);

  const openDevice = useCallback(
    (deviceId: string) => navigation.navigate('DeviceDetail', { deviceId }),
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: CachedDevice }) => (
      <DeviceRow
        device={item}
        now={scan.now}
        connectionState={connections[item.id]?.state ?? 'disconnected'}
        onPress={openDevice}
      />
    ),
    [scan.now, connections, openDevice],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
        data={devices}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: theme.colors.textPrimary }]}
            >
              Beacon
            </Text>
            <ReadinessPanel handle={bluetooth} />
            <PrimaryButton
              label={button.label}
              onPress={onScanPress}
              disabled={button.intent === undefined}
              testID="scan-toggle"
            />
            <FilterBar filters={filters} onChange={setFilters} />
            <View accessibilityLiveRegion="polite" testID="scan-summary">
              <Text
                accessibilityRole="header"
                style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}
                testID="scan-summary-title"
              >
                {summary.title}
              </Text>
              <Text
                style={[styles.sectionDetail, { color: theme.colors.textSecondary }]}
                testID="scan-summary-detail"
              >
                {summary.detail}
              </Text>
            </View>
          </View>
        }
        renderItem={renderItem}
        testID="device-list"
      />
    </View>
  );
}

function keyExtractor(device: CachedDevice): string {
  return device.id;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    gap: 10,
  },
  header: {
    gap: 16,
    marginBottom: 6,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  sectionDetail: {
    fontSize: 14,
    marginTop: 2,
  },
});
