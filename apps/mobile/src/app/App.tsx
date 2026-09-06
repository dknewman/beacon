import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceListScreen } from '../features/scan/DeviceListScreen';
import type { BleClient } from '../native/BleClient';
import { BleClientProvider } from '../native/BleClientContext';

export interface AppProps {
  bleClient: BleClient;
}

export function App({ bleClient }: AppProps): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <BleClientProvider client={bleClient}>
        <DeviceListScreen />
      </BleClientProvider>
    </SafeAreaProvider>
  );
}
