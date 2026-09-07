import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toShortUuid, type BleSession, type SessionEvent } from '@beacon/ble-contracts';
import type {
  RootNavigation,
  SessionDetailRoute,
} from '../../app/navigation/RootNavigator';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StatusRow } from '../../components/StatusRow';
import { useTheme } from '../../theme/useTheme';
import { formatPacketTime } from '../packets/packetPresentation';
import {
  describeSessionEvent,
  formatDuration,
  labelPath,
  labelSession,
} from './sessionPresentation';
import type { DeviceRecording } from './sessionRecorderReducer';
import { useSessionRecorder } from './SessionRecorderProvider';
import {
  summarizeSession,
  type CharacteristicStatistics,
  type SessionStatistics,
} from './sessionStatistics';
import { messageOf, useLoadState } from './useLoadState';

interface LoadedSession {
  session: BleSession;
  events: SessionEvent[];
}

/**
 * Session detail (PROJECT.md 20, M8): the statistics, the busiest
 * characteristics and the full timeline of one session. While the session is
 * still being recorded the timeline is read again each time the recorder
 * acknowledges more events, so it grows in front of the person watching.
 * The timeline list is the screen's one scroll container; everything above
 * it is the list header.
 */
export function SessionDetailScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<SessionDetailRoute>();
  const recorder = useSessionRecorder();
  const { repository } = recorder;
  const sessionId = params.sessionId;

  const load = useCallback(async (): Promise<LoadedSession | undefined> => {
    const session = await repository.getSession(sessionId);
    if (session === undefined) {
      return undefined;
    }
    const events = await repository.listEvents(sessionId);
    return { session, events };
  }, [repository, sessionId]);

  const live = Object.values(recorder.state.devices).find(
    (recording): recording is OpenRecording => isOpenRecordingOf(recording, sessionId),
  );
  const { state, retry } = useLoadState(
    load,
    true,
    `${recorder.state.revision}:${live?.eventCount ?? -1}`,
  );

  const [deletion, setDeletion] = useState<
    { phase: 'idle'; error?: string } | { phase: 'deleting' }
  >({ phase: 'idle' });
  const onDelete = useCallback(() => {
    setDeletion({ phase: 'deleting' });
    repository.deleteSession(sessionId).then(
      () => {
        recorder.notifySessionsChanged();
        navigation.goBack();
      },
      (error: unknown) => setDeletion({ phase: 'idle', error: messageOf(error) }),
    );
  }, [navigation, recorder, repository, sessionId]);

  const loaded = state.phase === 'ready' ? state.value : undefined;
  const statistics = useMemo(
    () =>
      loaded === undefined ? undefined : summarizeSession(loaded.session, loaded.events),
    [loaded],
  );

  const renderItem = useCallback(
    ({ item }: { item: SessionEvent }) => <EventRow event={item} />,
    [],
  );

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to sessions"
        hitSlop={12}
        onPress={() => navigation.goBack()}
        style={styles.back}
        testID="session-detail-back"
      >
        <Text style={[styles.backLabel, { color: theme.colors.accent }]}>‹ Sessions</Text>
      </Pressable>

      {state.phase === 'loading' ? (
        <>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: theme.colors.textPrimary }]}
            testID="session-detail-title"
          >
            Session
          </Text>
          <StatusRow
            label="Status"
            value="Loading"
            detail="Reading the session."
            testID="session-detail-loading"
          />
        </>
      ) : state.phase === 'failed' ? (
        <>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: theme.colors.textPrimary }]}
            testID="session-detail-title"
          >
            Session
          </Text>
          <StatusRow
            label="Status"
            value="Failed"
            detail={state.message}
            testID="session-detail-failed"
          />
          <PrimaryButton
            label="Try again"
            onPress={retry}
            testID="session-detail-retry"
          />
        </>
      ) : loaded === undefined || statistics === undefined ? (
        <>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: theme.colors.textPrimary }]}
            testID="session-detail-title"
          >
            Session not found
          </Text>
          <Text
            style={[styles.hint, { color: theme.colors.textSecondary }]}
            testID="session-detail-missing"
          >
            This session is no longer stored. It may have been deleted.
          </Text>
        </>
      ) : (
        <SessionSummary
          session={loaded.session}
          statistics={statistics}
          live={live !== undefined}
        />
      )}
    </View>
  );

  const footer =
    loaded === undefined ? undefined : (
      <View style={styles.footer}>
        <PrimaryButton
          label={deletion.phase === 'deleting' ? 'Deleting…' : 'Delete session'}
          onPress={onDelete}
          disabled={live !== undefined || deletion.phase === 'deleting'}
          testID="session-delete"
        />
        {live === undefined ? null : (
          <Text
            style={[styles.hint, { color: theme.colors.textSecondary }]}
            testID="session-delete-hint"
          >
            Stop the session from the device screen before deleting it.
          </Text>
        )}
        {deletion.phase === 'idle' && deletion.error !== undefined ? (
          <Text
            style={[styles.hint, { color: theme.colors.textSecondary }]}
            testID="session-delete-error"
          >
            {deletion.error}
          </Text>
        ) : null}
      </View>
    );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
        ]}
        data={loaded?.events ?? []}
        keyExtractor={keyExtractor}
        ListEmptyComponent={
          loaded === undefined ? undefined : (
            <Text
              style={[styles.hint, { color: theme.colors.textSecondary }]}
              testID="timeline-empty"
            >
              No events recorded yet.
            </Text>
          )
        }
        ListFooterComponent={footer}
        ListHeaderComponent={header}
        renderItem={renderItem}
        testID="session-detail"
      />
    </View>
  );
}

type OpenRecording = Extract<DeviceRecording, { phase: 'recording' | 'stopping' }>;

/** True while the recorder still writes to the session. */
function isOpenRecordingOf(
  recording: DeviceRecording,
  sessionId: string,
): recording is OpenRecording {
  return (
    (recording.phase === 'recording' || recording.phase === 'stopping') &&
    recording.session.id === sessionId
  );
}

interface SessionSummaryProps {
  session: BleSession;
  statistics: SessionStatistics;
  live: boolean;
}

function SessionSummary({
  session,
  statistics,
  live,
}: SessionSummaryProps): React.JSX.Element {
  const theme = useTheme();
  const label = labelSession(session);
  return (
    <>
      <Text
        accessibilityRole="header"
        numberOfLines={2}
        style={[styles.title, { color: theme.colors.textPrimary }]}
        testID="session-detail-title"
      >
        {label.title}
      </Text>
      <Text
        style={[styles.subtitle, { color: theme.colors.textSecondary }]}
        testID="session-detail-subtitle"
      >
        {label.subtitle}
      </Text>

      <View
        style={[styles.card, { backgroundColor: theme.colors.surface }]}
        testID="session-statistics"
      >
        <Text style={[styles.cardLabel, { color: theme.colors.textSecondary }]}>
          Statistics
        </Text>
        <StatLine
          label="Duration"
          value={`${formatDuration(statistics.durationMs)}${live ? ' so far' : ''}`}
          testID="stat-duration"
        />
        <StatLine
          label="Events"
          value={String(statistics.eventCount)}
          testID="stat-events"
        />
        <StatLine
          label="Packets"
          value={String(statistics.packetCount)}
          testID="stat-packets"
        />
        <StatLine
          label="Bytes"
          value={`${statistics.bytesReceived} received, ${statistics.bytesSent} sent`}
          testID="stat-bytes"
        />
        {statistics.notificationsPerSecond === undefined ? null : (
          <StatLine
            label="Notification rate"
            value={`${formatRate(statistics.notificationsPerSecond)} per second`}
            testID="stat-rate"
          />
        )}
        {statistics.rssi === undefined ? null : (
          <StatLine
            label="RSSI"
            value={`${statistics.rssi.average} dBm average, ${statistics.rssi.min} to ${statistics.rssi.max} dBm over ${statistics.rssi.samples} ${
              statistics.rssi.samples === 1 ? 'sample' : 'samples'
            }`}
            testID="stat-rssi"
          />
        )}
      </View>

      {statistics.characteristics.length === 0 ? null : (
        <View
          style={[styles.card, { backgroundColor: theme.colors.surface }]}
          testID="characteristic-statistics"
        >
          <Text style={[styles.cardLabel, { color: theme.colors.textSecondary }]}>
            Characteristics
          </Text>
          {statistics.characteristics.map(entry => (
            <CharacteristicLine
              key={`${entry.serviceUuid}/${entry.characteristicUuid}`}
              entry={entry}
            />
          ))}
        </View>
      )}

      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}
      >
        Timeline
      </Text>
    </>
  );
}

interface StatLineProps {
  label: string;
  value: string;
  testID: string;
}

function StatLine({ label, value, testID }: StatLineProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${value}`}
      style={styles.statLine}
      testID={testID}
    >
      <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>
        {label}
      </Text>
      <Text
        style={[styles.statValue, { color: theme.colors.textPrimary }]}
        testID={`${testID}-value`}
      >
        {value}
      </Text>
    </View>
  );
}

function CharacteristicLine({
  entry,
}: {
  entry: CharacteristicStatistics;
}): React.JSX.Element {
  const theme = useTheme();
  const code = toShortUuid(entry.characteristicUuid) ?? entry.characteristicUuid;
  const detail = `${entry.reads} reads · ${entry.writes} writes · ${entry.notifications} notifications · ${entry.bytes} bytes`;
  return (
    <View
      accessible
      accessibilityLabel={`${labelPath(entry.serviceUuid, entry.characteristicUuid)}, ${detail}`}
      style={[styles.characteristic, { borderTopColor: theme.colors.background }]}
      testID={`characteristic-stat-${code}`}
    >
      <Text style={[styles.characteristicPath, { color: theme.colors.textPrimary }]}>
        {labelPath(entry.serviceUuid, entry.characteristicUuid)}
      </Text>
      <Text style={[styles.characteristicDetail, { color: theme.colors.textSecondary }]}>
        {detail}
      </Text>
    </View>
  );
}

function EventRow({ event }: { event: SessionEvent }): React.JSX.Element {
  const theme = useTheme();
  const label = describeSessionEvent(event);
  const time = formatPacketTime(event.timestamp);
  return (
    <View
      accessible
      accessibilityLabel={
        label.detail === undefined
          ? `${time}, ${label.title}`
          : `${time}, ${label.title}, ${label.detail}`
      }
      style={[styles.event, { backgroundColor: theme.colors.surface }]}
      testID={`event-${event.sequence}`}
    >
      <Text style={[styles.eventTime, { color: theme.colors.textSecondary }]}>
        {time}
      </Text>
      <Text
        style={[styles.eventTitle, { color: theme.colors.accent }]}
        testID={`event-${event.sequence}-title`}
      >
        {label.title}
      </Text>
      {label.detail === undefined ? null : (
        <Text
          selectable
          style={[styles.eventDetail, { color: theme.colors.textPrimary }]}
          testID={`event-${event.sequence}-detail`}
        >
          {label.detail}
        </Text>
      )}
    </View>
  );
}

function formatRate(perSecond: number): string {
  return perSecond >= 10 ? String(Math.round(perSecond)) : perSecond.toFixed(1);
}

function keyExtractor(event: SessionEvent): string {
  return event.id;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    gap: 8,
  },
  header: {
    gap: 12,
    marginBottom: 4,
  },
  footer: {
    gap: 8,
    marginTop: 12,
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
  subtitle: {
    fontSize: 14,
    marginTop: -6,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
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
  statLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  statLabel: {
    fontSize: 14,
  },
  statValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
  },
  characteristic: {
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  characteristicPath: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  characteristicDetail: {
    fontSize: 13,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 4,
  },
  event: {
    borderRadius: 10,
    padding: 12,
    gap: 2,
  },
  eventTime: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  eventDetail: {
    fontSize: 15,
    fontFamily: 'monospace',
  },
});
