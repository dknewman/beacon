import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { BleClient } from './BleClient';

const BleClientContext = createContext<BleClient | undefined>(undefined);

export interface BleClientProviderProps {
  client: BleClient;
}

export function BleClientProvider({
  client,
  children,
}: PropsWithChildren<BleClientProviderProps>): React.JSX.Element {
  return <BleClientContext.Provider value={client}>{children}</BleClientContext.Provider>;
}

/** Throws early and loudly if a screen is rendered outside the provider. */
export function useBleClient(): BleClient {
  const client = useContext(BleClientContext);
  if (client === undefined) {
    throw new Error('useBleClient must be used within a BleClientProvider');
  }
  return client;
}
