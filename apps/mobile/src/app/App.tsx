import React from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityBusProvider } from '../features/activity/ActivityBusProvider';
import { ConnectionProvider } from '../features/connection/ConnectionProvider';
import { GattProvider } from '../features/gatt/GattProvider';
import { PacketLogProvider } from '../features/packets/PacketLogProvider';
import { ScanProvider } from '../features/scan/ScanProvider';
import type { SessionRepository } from '../features/sessions/SessionRepository';
import { SessionRecorderProvider } from '../features/sessions/SessionRecorderProvider';
import { SubscriptionProvider } from '../features/subscriptions/SubscriptionProvider';
import type { BleClient } from '../native/BleClient';
import { BleClientProvider } from '../native/BleClientContext';
import { useTheme } from '../theme/useTheme';
import { RootNavigator } from './navigation/RootNavigator';

export interface AppProps {
  bleClient: BleClient;
  sessionRepository: SessionRepository;
}

/**
 * Provider order matters: the BLE client feeds the coordinators, the
 * coordinators publish on the activity bus above them, the session recorder
 * below them listens, and all of it sits above navigation so state survives
 * screen changes.
 */
export function App({ bleClient, sessionRepository }: AppProps): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <BleClientProvider client={bleClient}>
        <ActivityBusProvider>
          <ScanProvider>
            <ConnectionProvider>
              <GattProvider>
                <PacketLogProvider>
                  <SubscriptionProvider>
                    <SessionRecorderProvider repository={sessionRepository}>
                      <ThemedNavigation />
                    </SessionRecorderProvider>
                  </SubscriptionProvider>
                </PacketLogProvider>
              </GattProvider>
            </ConnectionProvider>
          </ScanProvider>
        </ActivityBusProvider>
      </BleClientProvider>
    </SafeAreaProvider>
  );
}

function ThemedNavigation(): React.JSX.Element {
  const theme = useTheme();
  const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer
      theme={{
        ...base,
        colors: {
          ...base.colors,
          background: theme.colors.background,
          card: theme.colors.surface,
          text: theme.colors.textPrimary,
          primary: theme.colors.accent,
        },
      }}
    >
      <RootNavigator />
    </NavigationContainer>
  );
}
