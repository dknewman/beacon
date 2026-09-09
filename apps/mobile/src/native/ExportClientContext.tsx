import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { ExportClient } from './ExportClient';

const ExportClientContext = createContext<ExportClient | undefined>(undefined);

export interface ExportClientProviderProps {
  client: ExportClient;
}

export function ExportClientProvider({
  client,
  children,
}: PropsWithChildren<ExportClientProviderProps>): React.JSX.Element {
  return (
    <ExportClientContext.Provider value={client}>{children}</ExportClientContext.Provider>
  );
}

/** Throws early and loudly if a screen is rendered outside the provider. */
export function useExportClient(): ExportClient {
  const client = useContext(ExportClientContext);
  if (client === undefined) {
    throw new Error('useExportClient must be used within an ExportClientProvider');
  }
  return client;
}
