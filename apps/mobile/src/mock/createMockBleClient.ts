import {
  BleError,
  type BlePermissionState,
  type BluetoothState,
  type NativeBleEvent,
  type ScanOptions,
  type Unsubscribe,
} from '@beacon/ble-contracts';
import type { BleClient } from '../native/BleClient';
import { defaultMockPeripherals, type MockPeripheral } from './mockPeripherals';

/** Timer surface the mock uses, so tests can drive it with a fake scheduler. */
export interface MockScheduler {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

export interface MockBleClientOptions {
  peripherals?: MockPeripheral[];
  initialAdapterState?: BluetoothState;
  initialPermissionState?: BlePermissionState;
  /** Simulated bridge latency for every call. */
  latencyMs?: number;
  scheduler?: MockScheduler;
  /** Uniform random source in [0, 1); injectable for deterministic tests. */
  random?: () => number;
  now?: () => number;
}

/** Test and demo hooks that the real bridge does not have. */
export interface MockBleClient extends BleClient {
  /** Changes the simulated adapter state and emits the change event. */
  setAdapterState(state: BluetoothState): void;
  /** Changes what getPermissionState / requestPermission answer. */
  setPermissionState(state: BlePermissionState): void;
  /** Makes the next startScan reject (once) with this error. */
  failNextScanStart(error: BleError): void;
  /** Emits a scanner failure as the platform would after a scan was running. */
  failRunningScan(error: BleError): void;
  readonly isScanning: boolean;
}

const globalScheduler: MockScheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * In-process implementation of the M2 BleClient surface with scripted
 * peripherals (PROJECT.md 39). Behaves like native where it matters:
 * subscribe-before-read ordering, validated-shaped payloads, scan refusal when
 * the radio is off or permission is missing, and events that stop when the scan
 * stops. Selected at runtime through `USE_MOCK_BLE_CLIENT` in bootstrap.
 */
export function createMockBleClient(options: MockBleClientOptions = {}): MockBleClient {
  const peripherals = options.peripherals ?? defaultMockPeripherals;
  const latencyMs = options.latencyMs ?? 30;
  const scheduler = options.scheduler ?? globalScheduler;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  let adapterState: BluetoothState = options.initialAdapterState ?? 'powered_on';
  let permissionState: BlePermissionState = options.initialPermissionState ?? 'granted';
  let nextScanStartError: BleError | undefined;
  const listeners = new Set<(event: NativeBleEvent) => void>();
  const advertisers = new Map<string, unknown>();
  const rssiByPeripheral = new Map<string, number>();
  let scanFilter: string[] = [];

  const emit = (event: NativeBleEvent) => {
    listeners.forEach(listener => listener(event));
  };

  const later = <T>(produce: () => T): Promise<T> =>
    new Promise((resolve, reject) => {
      scheduler.setTimeout(() => {
        try {
          resolve(produce());
        } catch (error) {
          reject(error as Error);
        }
      }, latencyMs);
    });

  const advertise = (peripheral: MockPeripheral) => {
    const previous = rssiByPeripheral.get(peripheral.id) ?? peripheral.baseRssi;
    const step = Math.round((random() - 0.5) * 2 * peripheral.rssiJitter * 0.5);
    const drifted = clamp(
      previous + step,
      peripheral.baseRssi - peripheral.rssiJitter,
      peripheral.baseRssi + peripheral.rssiJitter,
    );
    rssiByPeripheral.set(peripheral.id, drifted);
    emit({
      type: 'scan.device_discovered',
      device: {
        id: peripheral.id,
        ...(peripheral.name === undefined ? {} : { name: peripheral.name }),
        ...(peripheral.localName === undefined
          ? {}
          : { localName: peripheral.localName }),
        rssi: drifted,
        connectable: peripheral.connectable,
        ...(peripheral.manufacturerData === undefined
          ? {}
          : { manufacturerData: peripheral.manufacturerData }),
        serviceUuids: [...peripheral.serviceUuids],
        lastSeenAt: new Date(now()).toISOString(),
      },
    });
  };

  const stopAdvertising = () => {
    advertisers.forEach(handle => scheduler.clearInterval(handle));
    advertisers.clear();
  };

  const startAdvertising = () => {
    for (const peripheral of peripherals) {
      if (!matchesFilter(peripheral, scanFilter)) {
        continue;
      }
      advertise(peripheral);
      advertisers.set(
        peripheral.id,
        scheduler.setInterval(
          () => advertise(peripheral),
          peripheral.advertisingIntervalMs,
        ),
      );
    }
  };

  return {
    get isScanning() {
      return advertisers.size > 0;
    },

    getBluetoothState: () => later(() => adapterState),

    getPermissionState: () => later(() => permissionState),

    requestPermission: () =>
      later(() => {
        if (permissionState === 'not_requested' || permissionState === 'denied') {
          permissionState = 'granted';
        }
        return permissionState;
      }),

    startScan: (scanOptions?: ScanOptions) =>
      later(() => {
        if (nextScanStartError !== undefined) {
          const error = nextScanStartError;
          nextScanStartError = undefined;
          throw error;
        }
        if (adapterState === 'unsupported') {
          throw new BleError({
            code: 'bluetooth_unsupported',
            message: 'This device has no Bluetooth Low Energy radio',
          });
        }
        if (permissionState !== 'granted') {
          throw new BleError({
            code: 'permission_denied',
            message: 'Bluetooth permission has not been granted',
          });
        }
        if (adapterState !== 'powered_on') {
          throw new BleError({
            code: 'bluetooth_powered_off',
            message: 'Bluetooth is not powered on',
          });
        }
        if (advertisers.size > 0) {
          return;
        }
        scanFilter = scanOptions?.serviceUuids ?? [];
        startAdvertising();
      }),

    stopScan: () =>
      later(() => {
        stopAdvertising();
      }),

    subscribe(listener: (event: NativeBleEvent) => void): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setAdapterState(state: BluetoothState) {
      adapterState = state;
      if (state !== 'powered_on') {
        // The platform drops the scan when the radio goes away.
        stopAdvertising();
      }
      emit({ type: 'bluetooth.state_changed', state });
    },

    setPermissionState(state: BlePermissionState) {
      permissionState = state;
    },

    failNextScanStart(error: BleError) {
      nextScanStartError = error;
    },

    failRunningScan(error: BleError) {
      stopAdvertising();
      emit({ type: 'ble.error', error: error.toInfo() });
    },
  };
}

function matchesFilter(peripheral: MockPeripheral, serviceUuids: string[]): boolean {
  if (serviceUuids.length === 0) {
    return true;
  }
  const wanted = new Set(serviceUuids.map(uuid => uuid.toUpperCase()));
  return peripheral.serviceUuids.some(uuid => wanted.has(uuid.toUpperCase()));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
