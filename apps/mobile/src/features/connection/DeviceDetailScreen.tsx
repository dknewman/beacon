import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toShortUuid } from '@beacon/ble-contracts';
import type {
  DeviceDetailRoute,
  RootNavigation,
} from '../../app/navigation/RootNavigator';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StatusRow } from '../../components/StatusRow';
import { useTheme } from '../../theme/useTheme';
import type { CachedDevice } from '../scan/deviceCache';
import { describeLastSeen } from '../scan/lastSeen';
import { useBluetoothSession } from '../scan/ScanProvider';
import { describeConnection, presentConnectionAction } from './connectionLabels';
import { useConnections } from './ConnectionProvider';

/** How often live RSSI is read while connected and this screen is in front. */
export const RSSI_POLL_MS = 3_000;

/**
 * Device detail (PROJECT.md 13): identity, signal, connection status and the
 * one connection action. Reads the device from the scan cache by id so it
 * keeps updating while the list scans in the background; a device that has
 * aged out of the cache is still shown from its last known record.
 */
export function DeviceDetailScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<DeviceDetailRoute>();
  const { scan, bluetooth } = useBluetoothSession();
  const connections = useConnections();
  const isFocused = useIsFocused();

  const cached = scan.devices.find(device => device.id === params.deviceId);
  const [lastKnown, setLastKnown] = useState<CachedDevice | undefined>(cached);
  useEffect(() => {
    if (cached !== undefined) {
      setLastKnown(cached);
    }
  }, [cached]);
  const device = cached ?? lastKnown;

  const connection = connections.connectionOf(params.deviceId);
  const label = describeConnection(connection);
  const action = presentConnectionAction(connection);
  const canUseRadio = bluetooth.readiness.kind === 'ready';

  const liveRssi = useLiveRssi(
    params.deviceId,
    connection.state === 'ready' && isFocused,
  );

  const onAction = useCallback(() => {
    switch (action.kind) {
      case 'connect':
        connections.connect(params.deviceId);
        break;
      case 'cancel':
      case 'disconnect':
        connections.disconnect(params.deviceId);
        break;
    }
  }, [action.kind, connections, params.deviceId]);

  const title = device?.name ?? device?.localName ?? 'Unknown device';
  const signal = presentSignal(liveRssi, device, scan.now);
  const services = device?.serviceUuids.map(uuid => toShortUuid(uuid) ?? uuid) ?? [];

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
      ]}
      style={{ backgroundColor: theme.colors.background }}
      testID="device-detail"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to device list"
        hitSlop={12}
        onPress={() => navigation.goBack()}
        style={styles.back}
        testID="detail-back"
      >
        <Text style={[styles.backLabel, { color: theme.colors.accent }]}>‹ Devices</Text>
      </Pressable>

      <Text
        accessibilityRole="header"
        numberOfLines={2}
        style={[styles.title, { color: theme.colors.textPrimary }]}
        testID="detail-title"
      >
        {title}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.identifier, { color: theme.colors.textSecondary }]}
        testID="detail-id"
      >
        {params.deviceId}
      </Text>

      <StatusRow
        label="Status"
        value={label.short}
        detail={label.description}
        testID="connection-status"
      />

      <PrimaryButton
        label={action.label}
        onPress={onAction}
        disabled={!action.enabled || (action.kind === 'connect' && !canUseRadio)}
        testID="connection-action"
      />

      {canUseRadio ? null : (
        <Text
          style={[styles.hint, { color: theme.colors.textSecondary }]}
          testID="detail-hint"
        >
          {bluetooth.presentation.detail}
        </Text>
      )}

      <StatusRow
        label="Signal"
        value={signal.value}
        detail={signal.detail}
        testID="signal"
      />

      {device === undefined ? null : (
        <StatusRow
          label="Advertisement"
          value={device.connectable === false ? 'Not connectable' : 'Connectable'}
          detail={describeAdvertisement(device, services)}
          testID="advertisement"
        />
      )}
    </ScrollView>
  );
}

/** Polls readRssi while `enabled`; the value clears when polling stops. */
function useLiveRssi(deviceId: string, enabled: boolean): number | undefined {
  const { readRssi } = useConnections();
  const [rssi, setRssi] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setRssi(undefined);
      return undefined;
    }
    let active = true;
    const read = () => {
      readRssi(deviceId).then(
        value => {
          if (active) {
            setRssi(value);
          }
        },
        () => {
          // A failed read is not a state change; the connection events say when the link ends.
        },
      );
    };
    read();
    const handle = setInterval(read, RSSI_POLL_MS);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, [deviceId, enabled, readRssi]);

  return rssi;
}

interface SignalPresentation {
  value: string;
  detail: string;
}

function presentSignal(
  liveRssi: number | undefined,
  device: CachedDevice | undefined,
  now: number,
): SignalPresentation {
  if (liveRssi !== undefined) {
    return {
      value: `${liveRssi} dBm`,
      detail: `${describeQuality(liveRssi)} · live from the link`,
    };
  }
  if (device?.rssi !== undefined) {
    return {
      value: `${device.rssi} dBm`,
      detail: `${describeQuality(device.rssi)} · from advertisements, last seen ${describeLastSeen(device.lastSeenAt, now)}`,
    };
  }
  return { value: 'Unknown', detail: 'No signal strength has been reported yet.' };
}

function describeQuality(rssi: number): string {
  if (rssi >= -60) {
    return 'Strong';
  }
  if (rssi >= -75) {
    return 'Good';
  }
  if (rssi >= -90) {
    return 'Weak';
  }
  return 'Very weak';
}

function describeAdvertisement(device: CachedDevice, services: string[]): string {
  const parts: string[] = [];
  parts.push(
    services.length === 0 ? 'No advertised services' : `Services: ${services.join(', ')}`,
  );
  if (device.manufacturerData !== undefined) {
    parts.push(`Manufacturer: ${device.manufacturerData}`);
  }
  parts.push(`${device.advertisementCount} advertisements seen`);
  return parts.join('\n');
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
  identifier: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: -6,
  },
  hint: {
    fontSize: 14,
  },
});
