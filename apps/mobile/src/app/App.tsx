import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { BluetoothAdapterApi } from '@beacon/ble-contracts';
import { BluetoothStatusScreen } from '../features/bluetooth/BluetoothStatusScreen';
import { BleClientProvider } from '../native/BleClientContext';

export interface AppProps {
  bleClient: BluetoothAdapterApi;
}

export function App({ bleClient }: AppProps): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <BleClientProvider client={bleClient}>
        <BluetoothStatusScreen />
      </BleClientProvider>
    </SafeAreaProvider>
  );
}
