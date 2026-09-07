import type { EventSubscription } from 'react-native';
import type { NativeBleEvent } from '@beacon/ble-contracts';
import { createNativeBleClient } from '../createNativeBleClient';
import type {
  BleErrorEvent,
  BluetoothStateChangedEvent,
  ConnectionStateChangedEvent,
  DeviceDiscoveredEvent,
  Spec,
} from '../specs/NativeBeaconBluetooth';

type SpecOverrides = Partial<
  Pick<
    Spec,
    | 'getBluetoothState'
    | 'getPermissionState'
    | 'requestPermission'
    | 'startScan'
    | 'stopScan'
    | 'connect'
    | 'disconnect'
    | 'readRssi'
    | 'discoverServices'
    | 'readCharacteristic'
    | 'writeCharacteristic'
  >
>;

type Handler<T> = (event: T) => void | Promise<void>;

function createEmitter<T>() {
  const handlers = new Set<Handler<T>>();
  const emitter = (handler: Handler<T>): EventSubscription => {
    handlers.add(handler);
    return {
      remove: () => {
        handlers.delete(handler);
      },
    };
  };
  const emit = (event: T) => {
    handlers.forEach(handler => {
      // The EventEmitter contract allows async handlers; the client under test is sync.
      const result = handler(event);
      if (result !== undefined) {
        throw new Error('Test handlers must be synchronous');
      }
    });
  };
  return { emitter, emit, count: () => handlers.size };
}

/** Hand-rolled stand-in for the codegen'd Turbo Module surface. */
function createFakeSpec(overrides: SpecOverrides = {}) {
  const stateChanged = createEmitter<BluetoothStateChangedEvent>();
  const discovered = createEmitter<DeviceDiscoveredEvent>();
  const connection = createEmitter<ConnectionStateChangedEvent>();
  const errors = createEmitter<BleErrorEvent>();
  const startScanCalls: Array<{ serviceUuids: string[]; allowDuplicates: boolean }> = [];
  const writeCalls: Array<{
    deviceId: string;
    serviceUuid: string;
    characteristicUuid: string;
    bytes: number[];
    withResponse: boolean;
  }> = [];
  const spec: Spec = {
    getBluetoothState: () => Promise.resolve('powered_on'),
    getPermissionState: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted'),
    startScan: (serviceUuids, allowDuplicates) => {
      startScanCalls.push({ serviceUuids, allowDuplicates });
      return Promise.resolve();
    },
    stopScan: () => Promise.resolve(),
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    readRssi: () => Promise.resolve(-61),
    discoverServices: () =>
      Promise.resolve([
        {
          uuid: '180d',
          primary: true,
          characteristics: [
            { serviceUuid: '180d', uuid: '2a37', properties: ['notify'] },
          ],
        },
      ]),
    readCharacteristic: () => Promise.resolve([0x02, 0x9a]),
    writeCharacteristic: (
      deviceId,
      serviceUuid,
      characteristicUuid,
      bytes,
      withResponse,
    ) => {
      writeCalls.push({ deviceId, serviceUuid, characteristicUuid, bytes, withResponse });
      return Promise.resolve();
    },
    ...overrides,
    onBluetoothStateChanged: stateChanged.emitter,
    onDeviceDiscovered: discovered.emitter,
    onConnectionStateChanged: connection.emitter,
    onBleError: errors.emitter,
  };
  return {
    spec,
    startScanCalls,
    writeCalls,
    emitState: stateChanged.emit,
    emitDevice: discovered.emit,
    emitConnection: connection.emit,
    emitError: errors.emit,
    handlerCount: () =>
      stateChanged.count() + discovered.count() + connection.count() + errors.count(),
  };
}

const discoveredDevice: DeviceDiscoveredEvent = {
  id: '9E0C6C1B-5C0B-4C27-9D43-7A6E2C1D2B11',
  name: 'QN Scale',
  rssi: -47,
  connectable: true,
  manufacturerData: '0D00A1B2',
  serviceUuids: ['181D', '0000180f-0000-1000-8000-00805f9b34fb'],
  lastSeenAt: '2026-09-06T14:47:21.301Z',
};

describe('createNativeBleClient', () => {
  describe('getBluetoothState', () => {
    it('returns validated adapter states', async () => {
      const client = createNativeBleClient(createFakeSpec().spec);
      await expect(client.getBluetoothState()).resolves.toBe('powered_on');
    });

    it('rejects with invalid_payload when native returns an unknown state string', async () => {
      const { spec } = createFakeSpec({
        getBluetoothState: () => Promise.resolve('CBManagerStatePoweredOn'),
      });
      await expect(createNativeBleClient(spec).getBluetoothState()).rejects.toMatchObject(
        {
          name: 'BleError',
          code: 'invalid_payload',
        },
      );
    });

    it('maps native rejections onto BleError preserving the native code', async () => {
      const { spec } = createFakeSpec({
        getBluetoothState: () =>
          Promise.reject(
            Object.assign(new Error('no central'), { code: 'bluetooth_unsupported' }),
          ),
      });
      await expect(createNativeBleClient(spec).getBluetoothState()).rejects.toMatchObject(
        {
          name: 'BleError',
          code: 'bluetooth_unsupported',
          message: 'no central',
        },
      );
    });

    it('falls back to native_failure for rejections without a contract code', async () => {
      const { spec } = createFakeSpec({
        getBluetoothState: () => Promise.reject(new Error('jni crash')),
      });
      await expect(createNativeBleClient(spec).getBluetoothState()).rejects.toMatchObject(
        {
          code: 'native_failure',
        },
      );
    });
  });

  describe('permissions', () => {
    it('returns validated permission states', async () => {
      const { spec } = createFakeSpec({
        getPermissionState: () => Promise.resolve('not_requested'),
        requestPermission: () => Promise.resolve('blocked'),
      });
      const client = createNativeBleClient(spec);
      await expect(client.getPermissionState()).resolves.toBe('not_requested');
      await expect(client.requestPermission()).resolves.toBe('blocked');
    });

    it('rejects raw platform values with invalid_payload', async () => {
      const { spec } = createFakeSpec({
        getPermissionState: () => Promise.resolve('PERMISSION_GRANTED'),
      });
      await expect(
        createNativeBleClient(spec).getPermissionState(),
      ).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    });

    it('maps request rejections such as a missing Android activity', async () => {
      const { spec } = createFakeSpec({
        requestPermission: () =>
          Promise.reject(
            Object.assign(new Error('No foreground activity'), {
              code: 'native_failure',
            }),
          ),
      });
      await expect(createNativeBleClient(spec).requestPermission()).rejects.toMatchObject(
        {
          code: 'native_failure',
          message: 'No foreground activity',
        },
      );
    });
  });

  describe('scanning', () => {
    it('passes scan options through with explicit defaults', async () => {
      const fake = createFakeSpec();
      const client = createNativeBleClient(fake.spec);
      await client.startScan();
      await client.startScan({ serviceUuids: ['180D'], allowDuplicates: true });
      expect(fake.startScanCalls).toEqual([
        { serviceUuids: [], allowDuplicates: false },
        { serviceUuids: ['180D'], allowDuplicates: true },
      ]);
    });

    it('maps start and stop rejections onto BleError', async () => {
      const { spec } = createFakeSpec({
        startScan: () =>
          Promise.reject(
            Object.assign(new Error('Bluetooth is off'), {
              code: 'bluetooth_powered_off',
            }),
          ),
        stopScan: () => Promise.reject(new Error('scanner gone')),
      });
      const client = createNativeBleClient(spec);
      await expect(client.startScan()).rejects.toMatchObject({
        name: 'BleError',
        code: 'bluetooth_powered_off',
      });
      await expect(client.stopScan()).rejects.toMatchObject({ code: 'native_failure' });
    });
  });

  describe('connections', () => {
    it('maps connect rejections to connection_failed by default', async () => {
      const { spec } = createFakeSpec({
        connect: () => Promise.reject(new Error('GATT 133')),
        disconnect: () => Promise.reject(new Error('gone')),
      });
      const client = createNativeBleClient(spec);
      await expect(client.connect('a')).rejects.toMatchObject({
        code: 'connection_failed',
      });
      await expect(client.disconnect('a')).rejects.toMatchObject({
        code: 'native_failure',
      });
    });

    it('normalizes discovered services and rejects malformed tables', async () => {
      const client = createNativeBleClient(createFakeSpec().spec);
      await expect(client.discoverServices('a')).resolves.toEqual([
        {
          uuid: '0000180D-0000-1000-8000-00805F9B34FB',
          primary: true,
          characteristics: [
            {
              serviceUuid: '0000180D-0000-1000-8000-00805F9B34FB',
              uuid: '00002A37-0000-1000-8000-00805F9B34FB',
              properties: ['notify'],
            },
          ],
        },
      ]);
      const { spec } = createFakeSpec({
        discoverServices: () =>
          Promise.resolve([
            { uuid: '180D', primary: true, characteristics: [{ uuid: '2A37' }] },
          ] as never),
      });
      await expect(
        createNativeBleClient(spec).discoverServices('a'),
      ).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    });

    it('validates read bytes and maps write modes onto the boolean flag', async () => {
      const fake = createFakeSpec();
      const client = createNativeBleClient(fake.spec);
      await expect(client.readCharacteristic('a', '180F', '2A19')).resolves.toEqual([
        0x02, 0x9a,
      ]);
      await client.writeCharacteristic({
        deviceId: 'a',
        serviceUuid: '180F',
        characteristicUuid: '2A19',
        bytes: [1, 2],
        mode: 'without_response',
      });
      await client.writeCharacteristic({
        deviceId: 'a',
        serviceUuid: '180F',
        characteristicUuid: '2A19',
        bytes: [3],
        mode: 'with_response',
      });
      expect(fake.writeCalls.map(call => [call.bytes, call.withResponse])).toEqual([
        [[1, 2], false],
        [[3], true],
      ]);

      const { spec } = createFakeSpec({
        readCharacteristic: () => Promise.resolve([256]),
        writeCharacteristic: () => Promise.reject(new Error('GATT 3')),
      });
      const bad = createNativeBleClient(spec);
      await expect(bad.readCharacteristic('a', '180F', '2A19')).rejects.toMatchObject({
        code: 'invalid_payload',
      });
      await expect(
        bad.writeCharacteristic({
          deviceId: 'a',
          serviceUuid: '180F',
          characteristicUuid: '2A19',
          bytes: [],
          mode: 'with_response',
        }),
      ).rejects.toMatchObject({ code: 'write_failed' });
    });

    it('validates RSSI reads', async () => {
      const good = createNativeBleClient(createFakeSpec().spec);
      await expect(good.readRssi('a')).resolves.toBe(-61);
      const { spec } = createFakeSpec({ readRssi: () => Promise.resolve(127) });
      await expect(createNativeBleClient(spec).readRssi('a')).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    });
  });

  describe('events', () => {
    it('delivers validated state change events', () => {
      const fake = createFakeSpec();
      const client = createNativeBleClient(fake.spec);
      const received: NativeBleEvent[] = [];
      const unsubscribe = client.subscribe(event => received.push(event));

      fake.emitState({ state: 'powered_off' });
      expect(received).toEqual([
        { type: 'bluetooth.state_changed', state: 'powered_off' },
      ]);

      unsubscribe();
      expect(fake.handlerCount()).toBe(0);
    });

    it('normalizes discovered devices before they reach the listener', () => {
      const fake = createFakeSpec();
      const client = createNativeBleClient(fake.spec);
      const received: NativeBleEvent[] = [];
      client.subscribe(event => received.push(event));

      fake.emitDevice(discoveredDevice);
      expect(received).toEqual([
        {
          type: 'scan.device_discovered',
          device: {
            ...discoveredDevice,
            serviceUuids: [
              '0000181D-0000-1000-8000-00805F9B34FB',
              '0000180F-0000-1000-8000-00805F9B34FB',
            ],
          },
        },
      ]);
    });

    it('delivers validated connection transitions and rejects unknown states', () => {
      const fake = createFakeSpec();
      const client = createNativeBleClient(fake.spec);
      const received: NativeBleEvent[] = [];
      client.subscribe(event => received.push(event));

      fake.emitConnection({ deviceId: 'a', state: 'ready' });
      fake.emitConnection({ deviceId: 'a', state: 'STATE_CONNECTED' });
      expect(received[0]).toEqual({
        type: 'connection.state_changed',
        deviceId: 'a',
        state: 'ready',
      });
      expect(received[1]).toMatchObject({
        type: 'ble.error',
        error: { code: 'invalid_payload' },
      });
    });

    it('delivers native error events with their contract code', () => {
      const fake = createFakeSpec();
      const client = createNativeBleClient(fake.spec);
      const received: NativeBleEvent[] = [];
      client.subscribe(event => received.push(event));

      fake.emitError({
        error: {
          code: 'scan_failed',
          message: 'Scanning too frequently',
          nativeCode: '6',
        },
      });
      expect(received).toEqual([
        {
          type: 'ble.error',
          error: {
            code: 'scan_failed',
            message: 'Scanning too frequently',
            nativeCode: '6',
          },
        },
      ]);
    });

    it('converts malformed native payloads into ble.error events instead of dropping them', () => {
      const fake = createFakeSpec();
      const client = createNativeBleClient(fake.spec);
      const received: NativeBleEvent[] = [];
      client.subscribe(event => received.push(event));

      fake.emitState({ state: 'STATE_ON' });
      fake.emitDevice({ ...discoveredDevice, rssi: 127, serviceUuids: ['not-a-uuid'] });
      expect(received).toHaveLength(2);
      expect(received[0]).toMatchObject({
        type: 'ble.error',
        error: { code: 'invalid_payload' },
      });
      expect(received[1]).toMatchObject({
        type: 'ble.error',
        error: { code: 'invalid_payload', message: expect.stringContaining('rssi') },
      });
    });

    it('removes every native subscription on unsubscribe', () => {
      const fake = createFakeSpec();
      const client = createNativeBleClient(fake.spec);
      const unsubscribe = client.subscribe(() => {});
      expect(fake.handlerCount()).toBe(4);
      unsubscribe();
      expect(fake.handlerCount()).toBe(0);
    });
  });
});
