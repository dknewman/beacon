import {
  BleError,
  type BlePermissionState,
  type BluetoothState,
  type ConnectionState,
  type GattCharacteristic,
  type GattService,
  type NativeBleEvent,
  type NotificationRequest,
  type ScanOptions,
  type Unsubscribe,
  type WriteCharacteristicRequest,
} from '@beacon/ble-contracts';
import type { BleClient } from '../native/BleClient';
import {
  defaultMockPeripherals,
  type MockNotifier,
  type MockPeripheral,
} from './mockPeripherals';

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
  /** Time between each connection transition (connecting → connected → discovering → ready). */
  connectStepMs?: number;
  scheduler?: MockScheduler;
  /** Uniform random source in [0, 1); injectable for deterministic tests. */
  random?: () => number;
  now?: () => number;
}

/** Test and demo hooks that the real bridge does not have. */
export interface MockBleClient extends BleClient {
  /** Changes the simulated adapter state and emits the change event; drops every link when not powered on. */
  setAdapterState(state: BluetoothState): void;
  /** Changes what getPermissionState / requestPermission answer. */
  setPermissionState(state: BlePermissionState): void;
  /** Makes the next startScan reject (once) with this error. */
  failNextScanStart(error: BleError): void;
  /** Emits a scanner failure as the platform would after a scan was running. */
  failRunningScan(error: BleError): void;
  /** Makes the next connect to this device fail (once) after the connecting step. */
  failNextConnect(deviceId: string, error: BleError): void;
  /** Makes the next connect to this device never complete, so the JS timeout has to act. */
  stallNextConnect(deviceId: string): void;
  /** Simulates the peripheral dropping an established link. */
  dropConnection(deviceId: string): void;
  /** Makes the next read of this characteristic reject (once) with this error. */
  failNextRead(deviceId: string, characteristicUuid: string, error: BleError): void;
  /** Makes the next write to this characteristic reject (once) with this error. */
  failNextWrite(deviceId: string, characteristicUuid: string, error: BleError): void;
  /** Makes the next setNotify for this characteristic reject (once) with this error. */
  failNextSetNotify(deviceId: string, characteristicUuid: string, error: BleError): void;
  /** Whether the mock is currently pushing values for this characteristic. */
  isNotifying(deviceId: string, characteristicUuid: string): boolean;
  /** Current scripted value of a characteristic, after any writes this session. */
  valueOf(deviceId: string, characteristicUuid: string): number[] | undefined;
  connectionStateOf(deviceId: string): ConnectionState;
  readonly isScanning: boolean;
}

const globalScheduler: MockScheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};

interface MockLink {
  state: ConnectionState;
  /** Pending step timer while connecting or disconnecting. */
  timer?: unknown;
  pendingConnect?: { resolve: () => void; reject: (error: BleError) => void };
  pendingDisconnect: Array<() => void>;
}

/**
 * In-process implementation of the M3 BleClient surface with scripted
 * peripherals (PROJECT.md 39). Behaves like native where it matters:
 * subscribe-before-read ordering, validated-shaped payloads, scan refusal when
 * the radio is off or permission is missing, events that stop when the scan
 * stops, connection transitions emitted one by one, errors emitted before the
 * `disconnected` they cause, and links dropped when the radio turns off.
 * Selected at runtime through `USE_MOCK_BLE_CLIENT` in bootstrap.
 */
export function createMockBleClient(options: MockBleClientOptions = {}): MockBleClient {
  const peripherals = options.peripherals ?? defaultMockPeripherals;
  const latencyMs = options.latencyMs ?? 30;
  const connectStepMs = options.connectStepMs ?? 250;
  const scheduler = options.scheduler ?? globalScheduler;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  let adapterState: BluetoothState = options.initialAdapterState ?? 'powered_on';
  let permissionState: BlePermissionState = options.initialPermissionState ?? 'granted';
  let nextScanStartError: BleError | undefined;
  const nextConnectErrors = new Map<string, BleError>();
  const stalledConnects = new Set<string>();
  const listeners = new Set<(event: NativeBleEvent) => void>();
  const advertisers = new Map<string, unknown>();
  const rssiByPeripheral = new Map<string, number>();
  const links = new Map<string, MockLink>();
  /** Characteristic values by `${deviceId}/${characteristicUuid}`; seeded lazily from the script. */
  const values = new Map<string, number[]>();
  const nextReadErrors = new Map<string, BleError>();
  const nextWriteErrors = new Map<string, BleError>();
  const nextNotifyErrors = new Map<string, BleError>();
  /** Running notifiers by value key: the interval handle and how many values went out. */
  const notifiers = new Map<string, { handle: unknown; sequence: number }>();
  let scanFilter: string[] = [];

  const valueKey = (deviceId: string, characteristicUuid: string) =>
    `${deviceId}/${characteristicUuid.toUpperCase()}`;

  /** Finds a characteristic on a ready link, throwing the errors native would. */
  const characteristicOf = (
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ): { peripheral: MockPeripheral; characteristic: GattCharacteristic } => {
    const link = links.get(deviceId);
    const peripheral = peripherals.find(candidate => candidate.id === deviceId);
    if (link === undefined || link.state !== 'ready' || peripheral === undefined) {
      throw new BleError({
        code: 'disconnected',
        message: `Not connected to ${deviceId}`,
      });
    }
    const service = peripheral.services.find(
      candidate => candidate.uuid.toUpperCase() === serviceUuid.toUpperCase(),
    );
    if (service === undefined) {
      throw new BleError({
        code: 'service_not_found',
        message: `Service ${serviceUuid} not found on ${deviceId}`,
      });
    }
    const characteristic = service.characteristics.find(
      candidate => candidate.uuid.toUpperCase() === characteristicUuid.toUpperCase(),
    );
    if (characteristic === undefined) {
      throw new BleError({
        code: 'characteristic_not_found',
        message: `Characteristic ${characteristicUuid} not found in ${serviceUuid}`,
      });
    }
    return { peripheral, characteristic };
  };

  const currentValue = (
    peripheral: MockPeripheral,
    characteristicUuid: string,
  ): number[] => {
    const key = valueKey(peripheral.id, characteristicUuid);
    const stored = values.get(key);
    if (stored !== undefined) {
      return stored;
    }
    const scripted = Object.entries(peripheral.values ?? {}).find(
      ([uuid]) => uuid.toUpperCase() === characteristicUuid.toUpperCase(),
    )?.[1];
    return scripted ?? [];
  };

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

  const driftRssi = (peripheral: MockPeripheral): number => {
    const previous = rssiByPeripheral.get(peripheral.id) ?? peripheral.baseRssi;
    const step = Math.round((random() - 0.5) * 2 * peripheral.rssiJitter * 0.5);
    const drifted = clamp(
      previous + step,
      peripheral.baseRssi - peripheral.rssiJitter,
      peripheral.baseRssi + peripheral.rssiJitter,
    );
    rssiByPeripheral.set(peripheral.id, drifted);
    return drifted;
  };

  const advertise = (peripheral: MockPeripheral) => {
    emit({
      type: 'scan.device_discovered',
      device: {
        id: peripheral.id,
        ...(peripheral.name === undefined ? {} : { name: peripheral.name }),
        ...(peripheral.localName === undefined
          ? {}
          : { localName: peripheral.localName }),
        rssi: driftRssi(peripheral),
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

  const linkOf = (deviceId: string): MockLink => {
    let link = links.get(deviceId);
    if (link === undefined) {
      link = { state: 'disconnected', pendingDisconnect: [] };
      links.set(deviceId, link);
    }
    return link;
  };

  const setLinkState = (deviceId: string, link: MockLink, state: ConnectionState) => {
    link.state = state;
    emit({ type: 'connection.state_changed', deviceId, state });
  };

  const clearStep = (link: MockLink) => {
    if (link.timer !== undefined) {
      scheduler.clearTimeout(link.timer);
      link.timer = undefined;
    }
  };

  /** Ends a link with an error (remote drop, failure) or cleanly (undefined). */
  const stopNotifiers = (deviceId: string) => {
    notifiers.forEach((notifier, key) => {
      if (key.startsWith(`${deviceId}/`)) {
        scheduler.clearInterval(notifier.handle);
        notifiers.delete(key);
      }
    });
  };

  const startNotifier = (
    peripheral: MockPeripheral,
    characteristic: GattCharacteristic,
    notifier: MockNotifier,
  ) => {
    const key = valueKey(peripheral.id, characteristic.uuid);
    if (notifiers.has(key)) {
      return;
    }
    const entry = { handle: undefined as unknown, sequence: 0 };
    entry.handle = scheduler.setInterval(() => {
      const bytes = notifier.produce(entry.sequence, random);
      entry.sequence += 1;
      values.set(key, [...bytes]);
      emit({
        type: 'characteristic.value_changed',
        deviceId: peripheral.id,
        serviceUuid: characteristic.serviceUuid,
        characteristicUuid: characteristic.uuid,
        bytes,
        timestamp: new Date(now()).toISOString(),
      });
    }, notifier.intervalMs);
    notifiers.set(key, entry);
  };

  const endLink = (deviceId: string, link: MockLink, error: BleError | undefined) => {
    clearStep(link);
    // The platform ends every subscription with the link.
    stopNotifiers(deviceId);
    if (error !== undefined) {
      emit({ type: 'ble.error', deviceId, error: error.toInfo() });
      link.pendingConnect?.reject(error);
    } else {
      link.pendingConnect?.reject(
        new BleError({ code: 'disconnected', message: 'Connection cancelled' }),
      );
    }
    link.pendingConnect = undefined;
    setLinkState(deviceId, link, 'disconnected');
    const waiters = link.pendingDisconnect;
    link.pendingDisconnect = [];
    waiters.forEach(resolve => resolve());
  };

  const stepConnection = (deviceId: string, link: MockLink) => {
    const next: Partial<Record<ConnectionState, ConnectionState>> = {
      connecting: 'connected',
      connected: 'discovering_services',
      discovering_services: 'ready',
    };
    const target = next[link.state];
    if (target === undefined) {
      return;
    }
    link.timer = scheduler.setTimeout(() => {
      link.timer = undefined;
      if (target === 'connected') {
        const failure = nextConnectErrors.get(deviceId);
        if (failure !== undefined) {
          nextConnectErrors.delete(deviceId);
          endLink(deviceId, link, failure);
          return;
        }
      }
      setLinkState(deviceId, link, target);
      if (target === 'ready') {
        link.pendingConnect?.resolve();
        link.pendingConnect = undefined;
      } else {
        stepConnection(deviceId, link);
      }
    }, connectStepMs);
  };

  const dropAllLinks = (error: BleError) => {
    links.forEach((link, deviceId) => {
      if (link.state !== 'disconnected') {
        endLink(deviceId, link, error);
      }
    });
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
        assertRadioUsable();
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

    connect: (deviceId: string) =>
      new Promise<void>((resolve, reject) => {
        scheduler.setTimeout(() => {
          try {
            assertRadioUsable();
          } catch (error) {
            reject(error as Error);
            return;
          }
          const peripheral = peripherals.find(candidate => candidate.id === deviceId);
          if (peripheral === undefined) {
            reject(
              new BleError({
                code: 'device_not_found',
                message: `Unknown device ${deviceId}`,
              }),
            );
            return;
          }
          const link = linkOf(deviceId);
          if (link.state === 'ready') {
            resolve();
            return;
          }
          if (link.state !== 'disconnected') {
            reject(
              new BleError({
                code: 'connection_failed',
                message: `A connection to ${deviceId} is already in progress`,
              }),
            );
            return;
          }
          link.pendingConnect = { resolve, reject };
          setLinkState(deviceId, link, 'connecting');
          if (stalledConnects.delete(deviceId)) {
            return;
          }
          stepConnection(deviceId, link);
        }, latencyMs);
      }),

    disconnect: (deviceId: string) =>
      new Promise<void>(resolve => {
        scheduler.setTimeout(() => {
          const link = linkOf(deviceId);
          if (link.state === 'disconnected') {
            resolve();
            return;
          }
          link.pendingDisconnect.push(resolve);
          if (link.state === 'disconnecting') {
            return;
          }
          const wasConnecting = link.state === 'connecting';
          clearStep(link);
          if (wasConnecting) {
            endLink(deviceId, link, undefined);
            return;
          }
          setLinkState(deviceId, link, 'disconnecting');
          link.timer = scheduler.setTimeout(() => {
            link.timer = undefined;
            endLink(deviceId, link, undefined);
          }, connectStepMs);
        }, latencyMs);
      }),

    readRssi: (deviceId: string) =>
      later(() => {
        const link = links.get(deviceId);
        const peripheral = peripherals.find(candidate => candidate.id === deviceId);
        if (link === undefined || link.state !== 'ready' || peripheral === undefined) {
          throw new BleError({
            code: 'disconnected',
            message: `Not connected to ${deviceId}`,
          });
        }
        return driftRssi(peripheral);
      }),

    discoverServices: (deviceId: string) =>
      later((): GattService[] => {
        const link = links.get(deviceId);
        const peripheral = peripherals.find(candidate => candidate.id === deviceId);
        if (link === undefined || link.state !== 'ready' || peripheral === undefined) {
          throw new BleError({
            code: 'disconnected',
            message: `Not connected to ${deviceId}`,
          });
        }
        return peripheral.services.map(item => ({
          ...item,
          characteristics: item.characteristics.map(characteristic => ({
            ...characteristic,
          })),
        }));
      }),

    readCharacteristic: (
      deviceId: string,
      serviceUuid: string,
      characteristicUuid: string,
    ) =>
      later((): number[] => {
        const { peripheral, characteristic } = characteristicOf(
          deviceId,
          serviceUuid,
          characteristicUuid,
        );
        const key = valueKey(deviceId, characteristicUuid);
        const scriptedError = nextReadErrors.get(key);
        if (scriptedError !== undefined) {
          nextReadErrors.delete(key);
          throw scriptedError;
        }
        if (!characteristic.properties.includes('read')) {
          throw new BleError({
            code: 'read_failed',
            message: 'Read not permitted',
            nativeCode: '2',
            nativeDomain: 'MockGatt',
          });
        }
        return [...currentValue(peripheral, characteristic.uuid)];
      }),

    writeCharacteristic: (request: WriteCharacteristicRequest) =>
      later((): void => {
        const { characteristic } = characteristicOf(
          request.deviceId,
          request.serviceUuid,
          request.characteristicUuid,
        );
        const key = valueKey(request.deviceId, request.characteristicUuid);
        const scriptedError = nextWriteErrors.get(key);
        if (scriptedError !== undefined) {
          nextWriteErrors.delete(key);
          throw scriptedError;
        }
        const needed =
          request.mode === 'with_response' ? 'write' : 'write_without_response';
        if (!characteristic.properties.includes(needed)) {
          throw new BleError({
            code: 'write_failed',
            message: 'Write not permitted',
            nativeCode: '3',
            nativeDomain: 'MockGatt',
          });
        }
        values.set(valueKey(request.deviceId, characteristic.uuid), [...request.bytes]);
      }),

    setNotify: (request: NotificationRequest) =>
      later((): void => {
        const { peripheral, characteristic } = characteristicOf(
          request.deviceId,
          request.serviceUuid,
          request.characteristicUuid,
        );
        const key = valueKey(request.deviceId, characteristic.uuid);
        const scriptedError = nextNotifyErrors.get(key);
        if (scriptedError !== undefined) {
          nextNotifyErrors.delete(key);
          throw scriptedError;
        }
        const supported =
          characteristic.properties.includes('notify') ||
          characteristic.properties.includes('indicate');
        if (!supported) {
          throw new BleError({
            code: 'subscription_failed',
            message: 'Notifications not supported',
            nativeDomain: 'MockGatt',
          });
        }
        if (!request.enabled) {
          const running = notifiers.get(key);
          if (running !== undefined) {
            scheduler.clearInterval(running.handle);
            notifiers.delete(key);
          }
          return;
        }
        const notifier = Object.entries(peripheral.notifiers ?? {}).find(
          ([uuid]) => uuid.toUpperCase() === characteristic.uuid.toUpperCase(),
        )?.[1];
        if (notifier === undefined) {
          // Subscribed, but this script never pushes anything: realistic for a
          // characteristic that only notifies on change.
          return;
        }
        startNotifier(peripheral, characteristic, notifier);
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
        // The platform drops the scan and every link when the radio goes away.
        stopAdvertising();
        dropAllLinks(
          new BleError({
            code: 'bluetooth_powered_off',
            message: 'Bluetooth turned off',
          }),
        );
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

    failNextConnect(deviceId: string, error: BleError) {
      nextConnectErrors.set(deviceId, error);
    },

    stallNextConnect(deviceId: string) {
      stalledConnects.add(deviceId);
    },

    dropConnection(deviceId: string) {
      const link = links.get(deviceId);
      if (link === undefined || link.state === 'disconnected') {
        return;
      }
      endLink(
        deviceId,
        link,
        new BleError({
          code: 'disconnected',
          message: 'The peripheral closed the connection',
        }),
      );
    },

    failNextRead(deviceId: string, characteristicUuid: string, error: BleError) {
      nextReadErrors.set(valueKey(deviceId, characteristicUuid), error);
    },

    failNextWrite(deviceId: string, characteristicUuid: string, error: BleError) {
      nextWriteErrors.set(valueKey(deviceId, characteristicUuid), error);
    },

    failNextSetNotify(deviceId: string, characteristicUuid: string, error: BleError) {
      nextNotifyErrors.set(valueKey(deviceId, characteristicUuid), error);
    },

    isNotifying(deviceId: string, characteristicUuid: string): boolean {
      return notifiers.has(valueKey(deviceId, characteristicUuid));
    },

    valueOf(deviceId: string, characteristicUuid: string): number[] | undefined {
      const peripheral = peripherals.find(candidate => candidate.id === deviceId);
      if (peripheral === undefined) {
        return undefined;
      }
      return [...currentValue(peripheral, characteristicUuid)];
    },

    connectionStateOf(deviceId: string): ConnectionState {
      return links.get(deviceId)?.state ?? 'disconnected';
    },
  };

  function assertRadioUsable(): void {
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
  }
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
