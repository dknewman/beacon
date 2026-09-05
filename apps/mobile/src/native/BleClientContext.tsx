import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { BluetoothAdapterApi } from '@beacon/ble-contracts';

const BleClientContext = createContext<BluetoothAdapterApi | undefined>(undefined);

export interface BleClientProviderProps {
  client: BluetoothAdapterApi;
}

export function BleClientProvider({
  client,
  children,
}: PropsWithChildren<BleClientProviderProps>): React.JSX.Element {
  return <BleClientContext.Provider value={client}>{children}</BleClientContext.Provider>;
}

/** Throws early and loudly if a screen is rendered outside the provider. */
export function useBluetoothAdapterClient(): BluetoothAdapterApi {
  const client = useContext(BleClientContext);
  if (client === undefined) {
    throw new Error('useBluetoothAdapterClient must be used within a BleClientProvider');
  }
  return client;
}
