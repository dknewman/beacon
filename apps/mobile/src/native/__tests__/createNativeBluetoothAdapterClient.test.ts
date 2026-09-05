import type { EventSubscription } from 'react-native';
import type { NativeBleEvent } from '@beacon/ble-contracts';
import { createNativeBluetoothAdapterClient } from '../createNativeBluetoothAdapterClient';
import type { BluetoothStateChangedEvent, Spec } from '../specs/NativeBeaconBluetooth';

/** Hand-rolled stand-in for the codegen'd Turbo Module surface. */
function createFakeSpec(getBluetoothState: () => Promise<string>) {
  const handlers = new Set<(event: BluetoothStateChangedEvent) => void | Promise<void>>();
  const spec: Spec = {
    getBluetoothState,
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

describe('createNativeBluetoothAdapterClient', () => {
  it('returns validated adapter states', async () => {
    const { spec } = createFakeSpec(() => Promise.resolve('powered_on'));
    const client = createNativeBluetoothAdapterClient(spec);
    await expect(client.getBluetoothState()).resolves.toBe('powered_on');
  });

  it('rejects with invalid_payload when native returns an unknown state string', async () => {
    const { spec } = createFakeSpec(() => Promise.resolve('CBManagerStatePoweredOn'));
    const client = createNativeBluetoothAdapterClient(spec);
    await expect(client.getBluetoothState()).rejects.toMatchObject({
      name: 'BleError',
      code: 'invalid_payload',
    });
  });

  it('maps native rejections onto BleError preserving the native code', async () => {
    const { spec } = createFakeSpec(() =>
      Promise.reject(
        Object.assign(new Error('no central'), { code: 'bluetooth_unsupported' }),
      ),
    );
    const client = createNativeBluetoothAdapterClient(spec);
    await expect(client.getBluetoothState()).rejects.toMatchObject({
      name: 'BleError',
      code: 'bluetooth_unsupported',
      message: 'no central',
    });
  });

  it('falls back to native_failure for rejections without a contract code', async () => {
    const { spec } = createFakeSpec(() => Promise.reject(new Error('jni crash')));
    const client = createNativeBluetoothAdapterClient(spec);
    await expect(client.getBluetoothState()).rejects.toMatchObject({
      code: 'native_failure',
    });
  });

  it('delivers validated state change events', () => {
    const fake = createFakeSpec(() => Promise.resolve('powered_on'));
    const client = createNativeBluetoothAdapterClient(fake.spec);
    const received: NativeBleEvent[] = [];
    const unsubscribe = client.subscribe(event => received.push(event));

    fake.emit({ state: 'powered_off' });
    expect(received).toEqual([{ type: 'bluetooth.state_changed', state: 'powered_off' }]);

    unsubscribe();
    expect(fake.handlerCount()).toBe(0);
  });

  it('converts malformed native payloads into ble.error events instead of dropping them', () => {
    const fake = createFakeSpec(() => Promise.resolve('powered_on'));
    const client = createNativeBluetoothAdapterClient(fake.spec);
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
