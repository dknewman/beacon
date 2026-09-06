import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { BluetoothReadinessHandle } from '../bluetooth/useBluetoothReadiness';
import { useBluetoothReadiness } from '../bluetooth/useBluetoothReadiness';
import { useScanCoordinator, type ScanCoordinatorHandle } from './useScanCoordinator';

export interface BluetoothSession {
  bluetooth: BluetoothReadinessHandle;
  scan: ScanCoordinatorHandle;
}

const ScanContext = createContext<BluetoothSession | undefined>(undefined);

/**
 * Hosts the readiness and scan coordinators above navigation so the device
 * cache and scan state survive moving between the list and a device's detail.
 */
export function ScanProvider({ children }: PropsWithChildren): React.JSX.Element {
  const bluetooth = useBluetoothReadiness();
  const scan = useScanCoordinator(bluetooth.readiness);
  return (
    <ScanContext.Provider value={{ bluetooth, scan }}>{children}</ScanContext.Provider>
  );
}

export function useBluetoothSession(): BluetoothSession {
  const value = useContext(ScanContext);
  if (value === undefined) {
    throw new Error('useBluetoothSession must be used within a ScanProvider');
  }
  return value;
}
