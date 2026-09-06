import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { toShortUuid, type ConnectionState } from '@beacon/ble-contracts';
import { useTheme } from '../../theme/useTheme';
import type { CachedDevice } from './deviceCache';
import { describeLastSeen } from './lastSeen';

export interface DeviceRowProps {
  device: CachedDevice;
  now: number;
  connectionState: ConnectionState;
  onPress: (deviceId: string) => void;
}

const MANUFACTURER_PREVIEW_BYTES = 8;

/**
 * One discovered peripheral. Everything the advertisement carried is visible
 * (PROJECT.md 10): name or "Unknown", RSSI, last seen, service UUIDs and a
 * preview of the manufacturer data. Text carries the state; no color-only cues.
 */
export const DeviceRow = React.memo(function DeviceRowInner({
  device,
  now,
  connectionState,
  onPress,
}: DeviceRowProps): React.JSX.Element {
  const theme = useTheme();
  const title = displayName(device);
  const rssi = describeRssi(device);
  const lastSeen = describeLastSeen(device.lastSeenAt, now);
  const services = device.serviceUuids.map(uuid => toShortUuid(uuid) ?? uuid);
  const manufacturer = previewHex(device.manufacturerData);
  const badge = connectionBadge(connectionState);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${rssi}, last seen ${lastSeen}${badge === undefined ? '' : `, ${badge}`}`}
      accessibilityHint="Opens the device detail"
      onPress={() => onPress(device.id)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.colors.surface, opacity: pressed ? 0.7 : 1 },
      ]}
      testID={`device-${device.id}`}
    >
      <View style={styles.headline}>
        <Text
          numberOfLines={1}
          style={[styles.name, { color: theme.colors.textPrimary }]}
          testID={`device-${device.id}-name`}
        >
          {title}
        </Text>
        <Text
          style={[styles.rssi, { color: theme.colors.textPrimary }]}
          testID={`device-${device.id}-rssi`}
        >
          {rssi}
        </Text>
      </View>
      <Text
        style={[styles.meta, { color: theme.colors.textSecondary }]}
        testID={`device-${device.id}-seen`}
      >
        {`Last seen ${lastSeen}`}
        {device.connectable === undefined
          ? ''
          : device.connectable
            ? ' · Connectable'
            : ' · Not connectable'}
        {badge === undefined ? '' : ` · ${badge}`}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.identifier, { color: theme.colors.textSecondary }]}
      >
        {device.id}
      </Text>
      {services.length === 0 ? null : (
        <Text
          numberOfLines={2}
          style={[styles.meta, { color: theme.colors.textSecondary }]}
          testID={`device-${device.id}-services`}
        >
          {`Services: ${services.join(', ')}`}
        </Text>
      )}
      {manufacturer === undefined ? null : (
        <Text
          numberOfLines={1}
          style={[styles.identifier, { color: theme.colors.textSecondary }]}
          testID={`device-${device.id}-manufacturer`}
        >
          {`Manufacturer: ${manufacturer}`}
        </Text>
      )}
    </Pressable>
  );
});

function displayName(device: CachedDevice): string {
  return device.name ?? device.localName ?? 'Unknown';
}

function describeRssi(device: CachedDevice): string {
  return device.rssi === undefined ? 'No RSSI' : `${device.rssi} dBm`;
}

function connectionBadge(state: ConnectionState): string | undefined {
  switch (state) {
    case 'disconnected':
      return undefined;
    case 'connecting':
      return 'Connecting';
    case 'connected':
    case 'discovering_services':
    case 'ready':
      return 'Connected';
    case 'disconnecting':
      return 'Disconnecting';
    case 'failed':
      return 'Connection failed';
  }
}

function previewHex(hex: string | undefined): string | undefined {
  if (hex === undefined || hex === '') {
    return undefined;
  }
  const bytes = hex.match(/.{1,2}/g) ?? [];
  const shown = bytes.slice(0, MANUFACTURER_PREVIEW_BYTES).join(' ');
  return bytes.length > MANUFACTURER_PREVIEW_BYTES ? `${shown} …` : shown;
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  headline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  name: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
  },
  rssi: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    fontSize: 13,
  },
  identifier: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
