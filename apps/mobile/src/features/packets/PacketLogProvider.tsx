import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type PropsWithChildren,
} from 'react';
import type { BlePacket } from '@beacon/ble-contracts';
import {
  initialPacketLogState,
  packetLogReducer,
  packetsForCharacteristic,
  packetsOf,
  type PacketLogAction,
  type PacketLogState,
} from './packetLogReducer';

export interface PacketLog {
  state: PacketLogState;
  record: (packet: BlePacket) => void;
  /** Records a burst (oldest first) as one state update; used by the notification pipeline. */
  recordMany: (packets: readonly BlePacket[]) => void;
  clear: (deviceId: string) => void;
  packetsOf: (deviceId: string) => readonly BlePacket[];
  packetsForCharacteristic: (
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ) => BlePacket[];
}

const PacketLogContext = createContext<PacketLog | undefined>(undefined);

const reduce = (state: PacketLogState, action: PacketLogAction): PacketLogState =>
  packetLogReducer(state, action);

/** Holds every device's packet log above navigation so screens share one history. */
export function PacketLogProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [state, dispatch] = useReducer(reduce, initialPacketLogState);

  const record = useCallback((packet: BlePacket) => {
    dispatch({ type: 'packet_recorded', packet });
  }, []);
  const recordMany = useCallback((packets: readonly BlePacket[]) => {
    dispatch({ type: 'packets_recorded', packets });
  }, []);
  const clear = useCallback((deviceId: string) => {
    dispatch({ type: 'log_cleared', deviceId });
  }, []);

  const value = useMemo<PacketLog>(
    () => ({
      state,
      record,
      recordMany,
      clear,
      packetsOf: deviceId => packetsOf(state, deviceId),
      packetsForCharacteristic: (deviceId, serviceUuid, characteristicUuid) =>
        packetsForCharacteristic(state, deviceId, serviceUuid, characteristicUuid),
    }),
    [state, record, recordMany, clear],
  );

  return <PacketLogContext.Provider value={value}>{children}</PacketLogContext.Provider>;
}

export function usePacketLog(): PacketLog {
  const value = useContext(PacketLogContext);
  if (value === undefined) {
    throw new Error('usePacketLog must be used within a PacketLogProvider');
  }
  return value;
}
