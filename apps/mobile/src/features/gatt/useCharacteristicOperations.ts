import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { toBleError, type WriteMode } from '@beacon/ble-contracts';
import { useBleClient } from '../../native/BleClientContext';
import { useActivityBus } from '../activity/ActivityBusProvider';
import { createPacket } from '../packets/packetLogReducer';
import { usePacketLog } from '../packets/PacketLogProvider';
import {
  characteristicOperationReducer,
  initialOperationState,
  type CharacteristicOperationState,
} from './characteristicOperations';

export interface CharacteristicOperations {
  state: CharacteristicOperationState;
  /** Reads once; ignored while another operation is in flight. */
  read: () => void;
  /** Writes the bytes; ignored while another operation is in flight. */
  write: (bytes: number[], mode: WriteMode) => void;
}

/**
 * Drives reads and writes for one characteristic and records every result in
 * the packet log (PROJECT.md 16): a successful read lands as an incoming
 * packet, a successful write as an outgoing one. Failures stay in the local
 * outcome so the screen can show the code; nothing is logged for them. Each
 * success is also published on the activity bus for the session recorder.
 */
export function useCharacteristicOperations(
  deviceId: string,
  serviceUuid: string,
  characteristicUuid: string,
): CharacteristicOperations {
  const client = useBleClient();
  const bus = useActivityBus();
  const { record } = usePacketLog();
  const [state, dispatch] = useReducer(
    characteristicOperationReducer,
    initialOperationState,
  );
  const busyRef = useRef(state.busy);
  busyRef.current = state.busy;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(() => {
    if (busyRef.current !== 'idle') {
      return;
    }
    busyRef.current = 'reading';
    dispatch({ type: 'read_started' });
    client.readCharacteristic(deviceId, serviceUuid, characteristicUuid).then(
      bytes => {
        const packet = createPacket({
          deviceId,
          serviceUuid,
          characteristicUuid,
          direction: 'incoming',
          bytes,
        });
        record(packet);
        bus.publish({
          deviceId,
          kind: 'read',
          serviceUuid,
          characteristicUuid,
          bytes,
          timestamp: packet.timestamp,
        });
        if (mounted.current) {
          dispatch({
            type: 'read_succeeded',
            byteCount: bytes.length,
            at: packet.timestamp,
          });
        }
      },
      (error: unknown) => {
        if (mounted.current) {
          dispatch({
            type: 'read_failed',
            error: toBleError(error, 'read_failed'),
            at: new Date().toISOString(),
          });
        }
      },
    );
  }, [bus, client, deviceId, serviceUuid, characteristicUuid, record]);

  const write = useCallback(
    (bytes: number[], mode: WriteMode) => {
      if (busyRef.current !== 'idle') {
        return;
      }
      busyRef.current = 'writing';
      dispatch({ type: 'write_started', mode });
      const payload = [...bytes];
      client
        .writeCharacteristic({
          deviceId,
          serviceUuid,
          characteristicUuid,
          bytes: payload,
          mode,
        })
        .then(
          () => {
            const packet = createPacket({
              deviceId,
              serviceUuid,
              characteristicUuid,
              direction: 'outgoing',
              bytes: payload,
            });
            record(packet);
            bus.publish({
              deviceId,
              kind: 'write',
              serviceUuid,
              characteristicUuid,
              bytes: payload,
              timestamp: packet.timestamp,
            });
            if (mounted.current) {
              dispatch({
                type: 'write_succeeded',
                byteCount: payload.length,
                mode,
                at: packet.timestamp,
              });
            }
          },
          (error: unknown) => {
            if (mounted.current) {
              dispatch({
                type: 'write_failed',
                error: toBleError(error, 'write_failed'),
                mode,
                at: new Date().toISOString(),
              });
            }
          },
        );
    },
    [bus, client, deviceId, serviceUuid, characteristicUuid, record],
  );

  return useMemo(() => ({ state, read, write }), [state, read, write]);
}
