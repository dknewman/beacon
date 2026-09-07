import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeServiceUuid, type CharacteristicProperty } from '@beacon/ble-contracts';
import type {
  CharacteristicDetailRoute,
  RootNavigation,
} from '../../app/navigation/RootNavigator';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StatusRow } from '../../components/StatusRow';
import { useTheme } from '../../theme/useTheme';
import { useConnections } from '../connection/ConnectionProvider';
import { usePacketLog } from '../packets/PacketLogProvider';
import { formatPacketTime, labelPacket } from '../packets/packetPresentation';
import {
  describeSubscription,
  type SubscriptionPhase,
} from '../subscriptions/subscriptionReducer';
import { useSubscriptions } from '../subscriptions/SubscriptionProvider';
import { describeBusy, describeOutcome } from './characteristicOperations';
import { describeProperties, labelCharacteristic } from './gattLabels';
import { useGatt } from './GattProvider';
import { useCharacteristicOperations } from './useCharacteristicOperations';
import { ValueColumns } from './ValueColumns';
import { WriteForm } from './WriteForm';

/** How many packets the screen lists; the log itself keeps more. */
const RECENT_PACKETS = 20;

/**
 * Characteristic detail (PROJECT.md 15, 16): identity and properties from the
 * discovered table, a read control, a write form gated on the properties,
 * the latest value in every column and the recent packets for this
 * characteristic. Controls are disabled with a reason rather than hidden
 * while the link is not ready.
 */
export function CharacteristicDetailScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<CharacteristicDetailRoute>();
  const gatt = useGatt();
  const connection = useConnections().connectionOf(params.deviceId);
  const status = gatt.statusOf(params.deviceId);
  const packetLog = usePacketLog();
  const subscriptions = useSubscriptions();
  const subscription = subscriptions.subscriptionOf(
    params.deviceId,
    params.serviceUuid,
    params.characteristicUuid,
  );
  const operations = useCharacteristicOperations(
    params.deviceId,
    params.serviceUuid,
    params.characteristicUuid,
  );

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
  const properties = characteristic?.properties ?? [];
  const ready = connection.state === 'ready' && characteristic !== undefined;
  const busy = operations.state.busy !== 'idle';
  const packets = packetLog.packetsForCharacteristic(
    params.deviceId,
    params.serviceUuid,
    params.characteristicUuid,
  );
  const latest = packets[0];
  const canRead = properties.includes('read');
  const canWrite =
    properties.includes('write') || properties.includes('write_without_response');
  const canNotify = properties.includes('notify') || properties.includes('indicate');
  const outcome = operations.state.lastOutcome;
  const subscriptionLabel = describeSubscription(subscription);
  const subscriptionBusy =
    subscription.phase === 'subscribing' || subscription.phase === 'unsubscribing';

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
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

      <View
        style={[styles.card, { backgroundColor: theme.colors.surface }]}
        testID="characteristic-value"
      >
        <Text style={[styles.cardLabel, { color: theme.colors.textSecondary }]}>
          Value
        </Text>
        {latest === undefined ? (
          <Text
            style={[styles.cardValue, { color: theme.colors.textPrimary }]}
            testID="characteristic-value-value"
          >
            Not read yet
          </Text>
        ) : (
          <>
            <Text
              style={[styles.cardDetail, { color: theme.colors.textSecondary }]}
              testID="characteristic-value-source"
            >
              {describeLatest(latest.direction, latest.timestamp, latest.bytes.length)}
            </Text>
            <ValueColumns bytes={latest.bytes} testID="value" />
          </>
        )}
      </View>

      {canRead ? (
        <PrimaryButton
          label={operations.state.busy === 'reading' ? 'Reading…' : 'Read'}
          accessibilityLabel={`Read ${label?.title ?? 'characteristic'}`}
          onPress={operations.read}
          disabled={!ready || busy}
          testID="characteristic-read"
        />
      ) : null}

      {canWrite ? (
        <WriteForm
          properties={properties}
          enabled={ready && !busy}
          busy={operations.state.busy === 'writing'}
          onWrite={operations.write}
        />
      ) : null}

      {canNotify ? (
        <>
          <StatusRow
            label="Notifications"
            value={subscriptionLabel.value}
            detail={subscriptionLabel.detail}
            testID="subscription-status"
          />
          <PrimaryButton
            label={subscribeButtonLabel(subscription.phase)}
            accessibilityLabel={`${subscribeButtonLabel(subscription.phase)} ${label?.title ?? 'characteristic'}`}
            onPress={() =>
              subscription.phase === 'on'
                ? subscriptions.unsubscribe(
                    params.deviceId,
                    params.serviceUuid,
                    params.characteristicUuid,
                  )
                : subscriptions.subscribe(
                    params.deviceId,
                    params.serviceUuid,
                    params.characteristicUuid,
                  )
            }
            disabled={!ready || subscriptionBusy}
            testID="characteristic-subscribe"
          />
        </>
      ) : null}

      {(canRead || canWrite || canNotify) && !ready ? (
        <Text
          style={[styles.hint, { color: theme.colors.textSecondary }]}
          testID="characteristic-hint"
        >
          Reads, writes and subscriptions need a ready connection. Reconnect from the
          device screen.
        </Text>
      ) : null}

      {busy || outcome !== undefined ? (
        <StatusRow
          label="Last operation"
          value={describeBusy(operations.state.busy) ?? describeOutcome(outcome!).value}
          detail={busy ? undefined : describeOutcome(outcome!).detail}
          testID="operation-status"
        />
      ) : null}

      <View style={styles.packets} testID="packet-list">
        <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
          {packets.length === 0
            ? 'Packets'
            : `Packets (${packets.length}${packets.length > RECENT_PACKETS ? `, latest ${RECENT_PACKETS}` : ''})`}
        </Text>
        {packets.length === 0 ? (
          <Text
            style={[styles.hint, { color: theme.colors.textSecondary }]}
            testID="packet-list-empty"
          >
            No packets yet. Reads, writes and notifications for this characteristic are
            listed here.
          </Text>
        ) : (
          packets.slice(0, RECENT_PACKETS).map((packet, index) => {
            const row = labelPacket(packet);
            return (
              <View
                accessible
                accessibilityLabel={row.accessibilityLabel}
                key={packet.id}
                style={[styles.packet, { backgroundColor: theme.colors.surface }]}
                testID={`packet-${index}`}
              >
                <View style={styles.packetHeader}>
                  <Text style={[styles.packetDirection, { color: theme.colors.accent }]}>
                    {packet.direction === 'incoming' ? '↓' : '↑'} {row.direction}
                  </Text>
                  <Text
                    style={[styles.packetMeta, { color: theme.colors.textSecondary }]}
                  >
                    {row.time} · {row.byteCount}
                  </Text>
                </View>
                <Text
                  selectable
                  style={[styles.packetHex, { color: theme.colors.textPrimary }]}
                  testID={`packet-${index}-hex`}
                >
                  {row.hex}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function describeLatest(
  direction: 'incoming' | 'outgoing',
  timestamp: string,
  byteCount: number,
): string {
  const verb = direction === 'incoming' ? 'Received' : 'Written';
  const count = byteCount === 1 ? '1 byte' : `${byteCount} bytes`;
  return `${verb} at ${formatPacketTime(timestamp)} · ${count}`;
}

function subscribeButtonLabel(phase: SubscriptionPhase): string {
  switch (phase) {
    case 'off':
      return 'Subscribe';
    case 'subscribing':
      return 'Subscribing…';
    case 'on':
      return 'Unsubscribe';
    case 'unsubscribing':
      return 'Unsubscribing…';
  }
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
  card: {
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: '600',
  },
  cardDetail: {
    fontSize: 14,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
  },
  packets: {
    gap: 8,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  packet: {
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  packetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  packetDirection: {
    fontSize: 13,
    fontWeight: '600',
  },
  packetMeta: {
    fontSize: 12,
  },
  packetHex: {
    fontSize: 15,
    fontFamily: 'monospace',
  },
});
