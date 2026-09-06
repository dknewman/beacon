import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { toBleError } from '@beacon/ble-contracts';
import { useBleClient } from '../../native/BleClientContext';
import type { BluetoothReadiness } from '../bluetooth/readiness/bluetoothReadiness';
import {
  emptyDeviceCache,
  selectDevices,
  upsertDevice,
  type CachedDevice,
  type DeviceCache,
} from './deviceCache';
import { initialScanStatus, scanReducer, type ScanStatus } from './scanReducer';
import { useNow } from './useNow';

export interface ScanCoordinatorOptions {
  /** Devices unseen for this long disappear from the list. */
  staleAfterMs?: number;
  /** How often "last seen" and stale hiding are re-evaluated while scanning. */
  tickMs?: number;
}

export interface ScanCoordinatorHandle {
  status: ScanStatus;
  /** Visible devices, strongest signal first. Already deduplicated and pruned. */
  devices: CachedDevice[];
  /** Total devices seen during this scan, including ones currently hidden as stale. */
  seenCount: number;
  /** Reference time used for the list, so rows and the coordinator agree on "now". */
  now: number;
  canStart: boolean;
  start: () => void;
  stop: () => void;
}

export const DEFAULT_STALE_AFTER_MS = 10_000;
const DEFAULT_TICK_MS = 1_000;

/**
 * The Scan Coordinator (PROJECT.md 11): owns the scan state machine and the
 * device cache, and is the only thing that calls the scan segment of the bridge.
 *
 * Rules:
 * - Scanning may start only while readiness is `ready`; if readiness leaves
 *   that state mid-scan (radio off, permission revoked) the scan is stopped and
 *   the readiness guidance takes over the screen.
 * - Discovery events are accepted only while starting or scanning, so an
 *   advertisement that arrives after stop is dropped rather than resurrecting a row.
 * - A stop requested while the start call is still in flight waits for it and
 *   then stops, so native never ends up scanning with the UI saying idle.
 * - Unmount stops any active scan; the native layer also stops on invalidate.
 */
export function useScanCoordinator(
  readiness: BluetoothReadiness,
  options: ScanCoordinatorOptions = {},
): ScanCoordinatorHandle {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const client = useBleClient();
  const [status, dispatch] = useReducer(scanReducer, initialScanStatus);
  const [cache, setCache] = useState<DeviceCache>(emptyDeviceCache);
  const statusRef = useRef(status);
  statusRef.current = status;
  const startInFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);

  const isActive = status.phase === 'starting' || status.phase === 'scanning';
  const now = useNow(tickMs, isActive);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = client.subscribe(event => {
      switch (event.type) {
        case 'scan.device_discovered': {
          const phase = statusRef.current.phase;
          if (phase === 'starting' || phase === 'scanning') {
            setCache(current => upsertDevice(current, event.device));
          }
          break;
        }
        case 'ble.error':
          if (event.deviceId === undefined && event.error.code === 'scan_failed') {
            dispatch({ type: 'native_failed', error: toBleError(event.error) });
          }
          break;
        default:
          break;
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [client]);

  const stop = useCallback(() => {
    const phase = statusRef.current.phase;
    if (phase !== 'starting' && phase !== 'scanning') {
      return;
    }
    dispatch({ type: 'stop_requested' });
    const pendingStart = startInFlight.current ?? Promise.resolve();
    pendingStart
      .catch(() => undefined)
      .then(() => client.stopScan())
      .then(
        () => {
          if (mounted.current) {
            dispatch({ type: 'stop_succeeded' });
          }
        },
        (error: unknown) => {
          if (mounted.current) {
            dispatch({ type: 'stop_failed', error: toBleError(error, 'native_failure') });
          }
        },
      );
  }, [client]);

  const canStart =
    readiness.kind === 'ready' && (status.phase === 'idle' || status.phase === 'failed');

  const start = useCallback(() => {
    const phase = statusRef.current.phase;
    if (readiness.kind !== 'ready' || (phase !== 'idle' && phase !== 'failed')) {
      return;
    }
    dispatch({ type: 'start_requested' });
    setCache(emptyDeviceCache);
    // Duplicates are requested so RSSI keeps updating; native throttles per peripheral
    // and the cache deduplicates by id (ADR 0004).
    const attempt = client.startScan({ allowDuplicates: true });
    startInFlight.current = attempt;
    attempt.then(
      () => {
        if (startInFlight.current === attempt) {
          startInFlight.current = null;
        }
        if (mounted.current) {
          dispatch({ type: 'start_succeeded' });
        }
      },
      (error: unknown) => {
        if (startInFlight.current === attempt) {
          startInFlight.current = null;
        }
        if (mounted.current) {
          dispatch({ type: 'start_failed', error: toBleError(error, 'scan_failed') });
        }
      },
    );
  }, [client, readiness.kind]);

  // Readiness is the gate: losing it mid-scan stops the scan.
  useEffect(() => {
    if (readiness.kind !== 'ready') {
      stop();
    }
  }, [readiness.kind, stop]);

  // Native cleanup on unmount; the reducer no longer matters at that point.
  useEffect(() => {
    return () => {
      const phase = statusRef.current.phase;
      if (phase === 'starting' || phase === 'scanning') {
        const pendingStart = startInFlight.current ?? Promise.resolve();
        pendingStart
          .catch(() => undefined)
          .then(() => client.stopScan())
          .catch(() => undefined);
      }
    };
  }, [client]);

  return {
    status,
    devices: selectDevices(cache, { now, staleAfterMs }),
    seenCount: Object.keys(cache.byId).length,
    now,
    canStart,
    start,
    stop,
  };
}
