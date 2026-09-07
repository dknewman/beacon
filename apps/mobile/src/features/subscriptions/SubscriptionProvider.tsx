import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type PropsWithChildren,
} from 'react';
import { toBleError, type BlePacket } from '@beacon/ble-contracts';
import { useBleClient } from '../../native/BleClientContext';
import { useActivityBus } from '../activity/ActivityBusProvider';
import { useConnections } from '../connection/ConnectionProvider';
import { createPacket } from '../packets/packetLogReducer';
import { usePacketLog } from '../packets/PacketLogProvider';
import {
  initialSubscriptionsState,
  subscriptionKey,
  subscriptionOf,
  subscriptionsReducer,
  type CharacteristicSubscription,
} from './subscriptionReducer';

export interface SubscriptionCoordinator {
  subscriptionOf: (
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ) => CharacteristicSubscription;
  /** Turns notifications on; ignored unless the subscription is off. */
  subscribe: (deviceId: string, serviceUuid: string, characteristicUuid: string) => void;
  /** Turns notifications off; ignored unless the subscription is on. */
  unsubscribe: (
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ) => void;
}

export interface SubscriptionProviderProps {
  /** How long incoming values are buffered before one batched state update. */
  flushIntervalMs?: number;
}

/**
 * Ten renders per second is invisible next to a 100 Hz notification stream and
 * keeps the JavaScript thread free for the values themselves (PROJECT.md 17, 37).
 */
export const DEFAULT_FLUSH_INTERVAL_MS = 100;

const SubscriptionContext = createContext<SubscriptionCoordinator | undefined>(undefined);

/**
 * Subscription coordinator and the buffered value pipeline (PROJECT.md 17).
 * Every `characteristic.value_changed` event is appended to a buffer; a timer
 * flushes the buffer at most once per interval as one packet-log batch and one
 * count update per characteristic, so a burst costs one render rather than one
 * per value. Subscriptions are dropped when their device leaves `ready`,
 * mirroring the platform, which ends them with the link.
 */
export function SubscriptionProvider({
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  children,
}: PropsWithChildren<SubscriptionProviderProps>): React.JSX.Element {
  const client = useBleClient();
  const bus = useActivityBus();
  const { connections } = useConnections();
  const { recordMany } = usePacketLog();
  const [state, dispatch] = useReducer(subscriptionsReducer, initialSubscriptionsState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const buffer = useRef<BlePacket[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    flushTimer.current = undefined;
    const packets = buffer.current;
    if (packets.length === 0) {
      return;
    }
    buffer.current = [];
    recordMany(packets);
    for (const packet of packets) {
      bus.publish({
        deviceId: packet.deviceId,
        kind: 'notification',
        serviceUuid: packet.serviceUuid,
        characteristicUuid: packet.characteristicUuid,
        bytes: packet.bytes,
        timestamp: packet.timestamp,
      });
    }
    const counts = new Map<string, { count: number; at: string }>();
    for (const packet of packets) {
      const key = subscriptionKey(
        packet.deviceId,
        packet.serviceUuid,
        packet.characteristicUuid,
      );
      const entry = counts.get(key);
      if (entry === undefined) {
        counts.set(key, { count: 1, at: packet.timestamp });
      } else {
        entry.count += 1;
        entry.at = packet.timestamp;
      }
    }
    dispatch({
      type: 'values_received',
      counts: [...counts.entries()].map(([key, entry]) => ({ key, ...entry })),
    });
  }, [bus, recordMany]);

  useEffect(() => {
    const unsubscribe = client.subscribe(event => {
      if (event.type !== 'characteristic.value_changed') {
        return;
      }
      buffer.current.push(
        createPacket({
          deviceId: event.deviceId,
          serviceUuid: event.serviceUuid,
          characteristicUuid: event.characteristicUuid,
          direction: 'incoming',
          bytes: event.bytes,
          timestamp: event.timestamp,
        }),
      );
      flushTimer.current ??= setTimeout(flush, flushIntervalMs);
    });
    return () => {
      unsubscribe();
      if (flushTimer.current !== undefined) {
        clearTimeout(flushTimer.current);
        flushTimer.current = undefined;
      }
      buffer.current = [];
    };
  }, [client, flush, flushIntervalMs]);

  useEffect(() => {
    const devices = new Set(Object.keys(stateRef.current).map(key => key.split('/')[0]));
    devices.forEach(deviceId => {
      if (deviceId !== undefined && connections[deviceId]?.state !== 'ready') {
        dispatch({ type: 'link_ended', deviceId });
      }
    });
  }, [connections]);

  const publishSubscription = useCallback(
    (
      deviceId: string,
      serviceUuid: string,
      characteristicUuid: string,
      enabled: boolean,
    ) => {
      bus.publish({
        deviceId,
        kind: 'subscription',
        serviceUuid,
        characteristicUuid,
        enabled,
        timestamp: new Date().toISOString(),
      });
    },
    [bus],
  );

  const subscribe = useCallback(
    (deviceId: string, serviceUuid: string, characteristicUuid: string) => {
      const key = subscriptionKey(deviceId, serviceUuid, characteristicUuid);
      if (subscriptionOf(stateRef.current, key).phase !== 'off') {
        return;
      }
      dispatch({ type: 'subscribe_requested', key });
      client.setNotify({ deviceId, serviceUuid, characteristicUuid, enabled: true }).then(
        () => {
          dispatch({ type: 'subscribe_succeeded', key });
          publishSubscription(deviceId, serviceUuid, characteristicUuid, true);
        },
        (error: unknown) =>
          dispatch({
            type: 'subscribe_failed',
            key,
            error: toBleError(error, 'subscription_failed'),
          }),
      );
    },
    [client, publishSubscription],
  );

  const unsubscribe = useCallback(
    (deviceId: string, serviceUuid: string, characteristicUuid: string) => {
      const key = subscriptionKey(deviceId, serviceUuid, characteristicUuid);
      if (subscriptionOf(stateRef.current, key).phase !== 'on') {
        return;
      }
      dispatch({ type: 'unsubscribe_requested', key });
      client
        .setNotify({ deviceId, serviceUuid, characteristicUuid, enabled: false })
        .then(
          () => {
            dispatch({ type: 'unsubscribe_succeeded', key });
            publishSubscription(deviceId, serviceUuid, characteristicUuid, false);
          },
          (error: unknown) =>
            dispatch({
              type: 'unsubscribe_failed',
              key,
              error: toBleError(error, 'subscription_failed'),
            }),
        );
    },
    [client, publishSubscription],
  );

  const value = useMemo<SubscriptionCoordinator>(
    () => ({
      subscriptionOf: (deviceId, serviceUuid, characteristicUuid) =>
        subscriptionOf(state, subscriptionKey(deviceId, serviceUuid, characteristicUuid)),
      subscribe,
      unsubscribe,
    }),
    [state, subscribe, unsubscribe],
  );

  return (
    <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
  );
}

export function useSubscriptions(): SubscriptionCoordinator {
  const value = useContext(SubscriptionContext);
  if (value === undefined) {
    throw new Error('useSubscriptions must be used within a SubscriptionProvider');
  }
  return value;
}
