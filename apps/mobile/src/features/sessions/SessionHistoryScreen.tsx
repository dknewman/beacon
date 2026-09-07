import React, { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BleSession } from '@beacon/ble-contracts';
import type {
  RootNavigation,
  SessionHistoryRoute,
} from '../../app/navigation/RootNavigator';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StatusRow } from '../../components/StatusRow';
import { useTheme } from '../../theme/useTheme';
import { useBluetoothSession } from '../scan/ScanProvider';
import { labelSession } from './sessionPresentation';
import { useSessionRecorder } from './SessionRecorderProvider';
import { useLoadState } from './useLoadState';

/**
 * Session history (PROJECT.md 20, M8): every recorded session, newest first,
 * or one device's when opened from its detail. Reads again whenever the
 * recorder reports a change to the stored sessions and whenever the screen
 * comes back into focus, so a delete or a stop elsewhere shows up here.
 */
export function SessionHistoryScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const navigation = useNavigation<RootNavigation>();
  const { params } = useRoute<SessionHistoryRoute>();
  const { scan } = useBluetoothSession();
  const recorder = useSessionRecorder();
  const isFocused = useIsFocused();
  const deviceId = params.deviceId;

  const load = useCallback(async () => {
    const sessions = await recorder.repository.listSessions();
    return deviceId === undefined
      ? sessions
      : sessions.filter(session => session.deviceId === deviceId);
  }, [deviceId, recorder.repository]);
  const { state, retry } = useLoadState(load, isFocused, recorder.state.revision);

  const openSession = useCallback(
    (sessionId: string) => navigation.navigate('SessionDetail', { sessionId }),
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: BleSession }) => (
      <SessionRow session={item} onOpen={openSession} />
    ),
    [openSession],
  );

  const device =
    deviceId === undefined
      ? undefined
      : scan.devices.find(entry => entry.id === deviceId);
  const title =
    deviceId === undefined
      ? 'Sessions'
      : `Sessions · ${device?.name ?? device?.localName ?? deviceId}`;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
        ]}
        data={state.phase === 'ready' ? state.value : []}
        keyExtractor={keyExtractor}
        ListEmptyComponent={
          state.phase === 'loading' ? (
            <StatusRow
              label="Status"
              value="Loading"
              detail="Reading the recorded sessions."
              testID="sessions-loading"
            />
          ) : state.phase === 'failed' ? (
            <>
              <StatusRow
                label="Status"
                value="Failed"
                detail={state.message}
                testID="sessions-failed"
              />
              <PrimaryButton label="Try again" onPress={retry} testID="sessions-retry" />
            </>
          ) : (
            <Text
              style={[styles.empty, { color: theme.colors.textSecondary }]}
              testID="sessions-empty"
            >
              {deviceId === undefined
                ? 'No sessions recorded yet. Open a device and press Start session.'
                : 'No sessions recorded for this device yet.'}
            </Text>
          )
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
              onPress={() => navigation.goBack()}
              style={styles.back}
              testID="sessions-back"
            >
              <Text style={[styles.backLabel, { color: theme.colors.accent }]}>
                {deviceId === undefined ? '‹ Devices' : '‹ Device'}
              </Text>
            </Pressable>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              style={[styles.title, { color: theme.colors.textPrimary }]}
              testID="sessions-title"
            >
              {title}
            </Text>
          </View>
        }
        renderItem={renderItem}
        testID="session-list"
      />
    </View>
  );
}

interface SessionRowProps {
  session: BleSession;
  onOpen: (sessionId: string) => void;
}

function SessionRow({ session, onOpen }: SessionRowProps): React.JSX.Element {
  const theme = useTheme();
  const label = labelSession(session);
  const recording = session.endedAt === undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label.title}, ${label.subtitle}`}
      accessibilityHint="Opens the session"
      onPress={() => onOpen(session.id)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.colors.surface, opacity: pressed ? 0.7 : 1 },
      ]}
      testID={`session-${session.id}`}
    >
      <View style={styles.rowHeadline}>
        <Text
          numberOfLines={1}
          style={[styles.rowTitle, { color: theme.colors.textPrimary }]}
          testID={`session-${session.id}-title`}
        >
          {label.title}
        </Text>
        {recording ? (
          <Text
            style={[
              styles.badge,
              { color: theme.colors.onAccent, backgroundColor: theme.colors.accent },
            ]}
            testID={`session-${session.id}-badge`}
          >
            Recording
          </Text>
        ) : null}
      </View>
      <Text
        style={[styles.rowSubtitle, { color: theme.colors.textSecondary }]}
        testID={`session-${session.id}-subtitle`}
      >
        {label.subtitle}
      </Text>
    </Pressable>
  );
}

function keyExtractor(session: BleSession): string {
  return session.id;
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
    gap: 12,
    marginBottom: 6,
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
  empty: {
    fontSize: 15,
    lineHeight: 21,
  },
  row: {
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  rowHeadline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rowTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
  },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  rowSubtitle: {
    fontSize: 14,
  },
});
