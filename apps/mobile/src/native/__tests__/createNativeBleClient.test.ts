import type { EventSubscription } from 'react-native';
import type { NativeBleEvent } from '@beacon/ble-contracts';
import { createNativeBleClient } from '../createNativeBleClient';
import type { BluetoothStateChangedEvent, Spec } from '../specs/NativeBeaconBluetooth';

type SpecOverrides = Partial<
  Pick<Spec, 'getBluetoothState' | 'getPermissionState' | 'requestPermission'>
>;

/** Hand-rolled stand-in for the codegen'd Turbo Module surface. */
function createFakeSpec(overrides: SpecOverrides = {}) {
  const handlers = new Set<(event: BluetoothStateChangedEvent) => void | Promise<void>>();
  const spec: Spec = {
    getBluetoothState: () => Promise.resolve('powered_on'),
    getPermissionState: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted'),
    ...overrides,
    onBluetoothStateChanged: handler => {
      handlers.add(handler);
      const subscription: EventSubscription = {
        remove: () => {
          handlers.delete(handler);
        },
      };
      return subscription;
    },
  };
  return {
    spec,
    emit: (event: BluetoothStateChangedEvent) => {
      handlers.forEach(handler => {
        // The EventEmitter contract allows async handlers; the client under test is sync.
        const result = handler(event);
        if (result !== undefined) {
          throw new Error('Test handlers must be synchronous');
        }
      });
    },
    handlerCount: () => handlers.size,
  };
}

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

  describe('events', () => {
    it('delivers validated state change events', () => {
      const fake = createFakeSpec();
      const client = createNativeBleClient(fake.spec);
      const received: NativeBleEvent[] = [];
      const unsubscribe = client.subscribe(event => received.push(event));

      fake.emit({ state: 'powered_off' });
      expect(received).toEqual([
        { type: 'bluetooth.state_changed', state: 'powered_off' },
      ]);

      unsubscribe();
      expect(fake.handlerCount()).toBe(0);
    });

    it('converts malformed native payloads into ble.error events instead of dropping them', () => {
      const fake = createFakeSpec();
      const client = createNativeBleClient(fake.spec);
      const received: NativeBleEvent[] = [];
      client.subscribe(event => received.push(event));

      fake.emit({ state: 'STATE_ON' });
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: 'ble.error',
        error: { code: 'invalid_payload' },
      });
    });
  });
});
