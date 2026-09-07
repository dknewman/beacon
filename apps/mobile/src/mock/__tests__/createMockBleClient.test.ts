import { BleError, type NativeBleEvent } from '@beacon/ble-contracts';
import { parseNativeBleEvent } from '@beacon/validation';
import { createMockBleClient, type MockScheduler } from '../createMockBleClient';
import { defaultMockPeripherals, HEART_RATE_SERVICE } from '../mockPeripherals';

/** Manual scheduler: timers fire only when the test advances the clock. */
function createFakeScheduler() {
  let clock = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; every?: number; callback: () => void }>();
  const scheduler: MockScheduler = {
    setTimeout: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: clock + ms, callback });
      return id;
    },
    clearTimeout: handle => {
      timers.delete(handle as number);
    },
    setInterval: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: clock + ms, every: ms, callback });
      return id;
    },
    clearInterval: handle => {
      timers.delete(handle as number);
    },
  };
  const advance = async (ms: number) => {
    const target = clock + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) {
        break;
      }
      const [id, timer] = due;
      clock = timer.at;
      if (timer.every === undefined) {
        timers.delete(id);
      } else {
        timer.at += timer.every;
      }
      timer.callback();
      await Promise.resolve();
    }
    clock = target;
  };
  return {
    scheduler,
    advance,
    now: () => 1_700_000_000_000 + clock,
    pending: () => timers.size,
  };
}

function createClient(overrides: Parameters<typeof createMockBleClient>[0] = {}) {
  const fake = createFakeScheduler();
  const client = createMockBleClient({
    scheduler: fake.scheduler,
    now: fake.now,
    random: () => 0.5,
    latencyMs: 10,
    ...overrides,
  });
  const events: NativeBleEvent[] = [];
  client.subscribe(event => events.push(event));
  return { client, events, advance: fake.advance, pending: fake.pending };
}

describe('createMockBleClient connections', () => {
  const HRM = 'MOCK-HRM-0001';
  const transitions = (events: NativeBleEvent[], id: string) =>
    events.flatMap(event =>
      event.type === 'connection.state_changed' && event.deviceId === id
        ? [event.state]
        : [],
    );

  it('walks the native transition sequence and resolves connect on ready', async () => {
    const { client, events, advance } = createClient({ connectStepMs: 100 });
    const connectCall = client.connect(HRM);
    await advance(10);
    expect(client.connectionStateOf(HRM)).toBe('connecting');
    await advance(300);
    await connectCall;
    expect(transitions(events, HRM)).toEqual([
      'connecting',
      'connected',
      'discovering_services',
      'ready',
    ]);
    const rssi = client.readRssi(HRM);
    await advance(10);
    await expect(rssi).resolves.toBeLessThan(0);
  });

  it('returns the scripted GATT table only while ready', async () => {
    const { client, advance } = createClient({ connectStepMs: 100 });
    const before = client.discoverServices(HRM);
    await advance(10);
    await expect(before).rejects.toMatchObject({ code: 'disconnected' });

    const connectCall = client.connect(HRM);
    await advance(320);
    await connectCall;
    const table = client.discoverServices(HRM);
    await advance(10);
    const services = await table;
    expect(services.map(service => service.uuid)).toContain(HEART_RATE_SERVICE);
    for (const service of services) {
      expect(parseNativeBleEvent).toBeDefined();
      for (const characteristic of service.characteristics) {
        expect(characteristic.serviceUuid).toBe(service.uuid);
      }
    }
  });

  it('reads scripted values and stores writes, refusing what the properties forbid', async () => {
    const BATTERY = '0000180F-0000-1000-8000-00805F9B34FB';
    const LEVEL = '00002A19-0000-1000-8000-00805F9B34FB';
    const HR_CONTROL = '00002A39-0000-1000-8000-00805F9B34FB';
    const { client, advance } = createClient({ connectStepMs: 100 });

    const before = client.readCharacteristic(HRM, BATTERY, LEVEL);
    await advance(10);
    await expect(before).rejects.toMatchObject({ code: 'disconnected' });

    const connectCall = client.connect(HRM);
    await advance(320);
    await connectCall;

    const level = client.readCharacteristic(HRM, BATTERY, LEVEL.toLowerCase());
    await advance(10);
    await expect(level).resolves.toEqual([0x5c]);

    const missing = client.readCharacteristic(
      HRM,
      BATTERY,
      '00002AFF-0000-1000-8000-00805F9B34FB',
    );
    await advance(10);
    await expect(missing).rejects.toMatchObject({ code: 'characteristic_not_found' });

    const wrongService = client.readCharacteristic(
      HRM,
      '0000FFFF-0000-1000-8000-00805F9B34FB',
      LEVEL,
    );
    await advance(10);
    await expect(wrongService).rejects.toMatchObject({ code: 'service_not_found' });

    const writeToReadOnly = client.writeCharacteristic({
      deviceId: HRM,
      serviceUuid: BATTERY,
      characteristicUuid: LEVEL,
      bytes: [1],
      mode: 'with_response',
    });
    await advance(10);
    await expect(writeToReadOnly).rejects.toMatchObject({ code: 'write_failed' });

    const controlPoint = client.writeCharacteristic({
      deviceId: HRM,
      serviceUuid: HEART_RATE_SERVICE,
      characteristicUuid: HR_CONTROL,
      bytes: [0x01],
      mode: 'with_response',
    });
    await advance(10);
    await expect(controlPoint).resolves.toBeUndefined();
    expect(client.valueOf(HRM, HR_CONTROL)).toEqual([0x01]);

    const withoutResponse = client.writeCharacteristic({
      deviceId: HRM,
      serviceUuid: HEART_RATE_SERVICE,
      characteristicUuid: HR_CONTROL,
      bytes: [0x02],
      mode: 'without_response',
    });
    await advance(10);
    await expect(withoutResponse).rejects.toMatchObject({ code: 'write_failed' });

    const readWriteOnly = client.readCharacteristic(HRM, HEART_RATE_SERVICE, HR_CONTROL);
    await advance(10);
    await expect(readWriteOnly).rejects.toMatchObject({ code: 'read_failed' });

    client.failNextRead(
      HRM,
      LEVEL,
      new BleError({ code: 'read_failed', message: 'status 133' }),
    );
    const scriptedFailure = client.readCharacteristic(HRM, BATTERY, LEVEL);
    await advance(10);
    await expect(scriptedFailure).rejects.toMatchObject({ message: 'status 133' });
    const recovered = client.readCharacteristic(HRM, BATTERY, LEVEL);
    await advance(10);
    await expect(recovered).resolves.toEqual([0x5c]);
  });

  it('rejects unknown devices and RSSI reads without a link', async () => {
    const { client, advance } = createClient();
    const unknown = client.connect('nope');
    await advance(10);
    await expect(unknown).rejects.toMatchObject({ code: 'device_not_found' });
    const rssi = client.readRssi(HRM);
    await advance(10);
    await expect(rssi).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('disconnects cleanly and cancels an attempt in progress', async () => {
    const { client, events, advance } = createClient({ connectStepMs: 100 });
    const first = client.connect(HRM);
    await advance(310);
    await first;
    const disconnectCall = client.disconnect(HRM);
    await advance(10);
    expect(client.connectionStateOf(HRM)).toBe('disconnecting');
    await advance(100);
    await disconnectCall;
    expect(client.connectionStateOf(HRM)).toBe('disconnected');
    expect(events.some(event => event.type === 'ble.error')).toBe(false);

    const second = client.connect(HRM);
    await advance(10);
    const cancel = client.disconnect(HRM);
    await advance(10);
    await expect(second).rejects.toMatchObject({ code: 'disconnected' });
    await cancel;
    expect(client.connectionStateOf(HRM)).toBe('disconnected');
  });

  it('scripts connection failures, stalls and remote drops with the error first', async () => {
    const { client, events, advance } = createClient({ connectStepMs: 100 });
    client.failNextConnect(
      HRM,
      new BleError({ code: 'connection_failed', message: 'refused' }),
    );
    const failing = client.connect(HRM);
    await advance(120);
    await expect(failing).rejects.toMatchObject({ code: 'connection_failed' });
    const errorIndex = events.findIndex(event => event.type === 'ble.error');
    const disconnectedIndex = events.findIndex(
      event =>
        event.type === 'connection.state_changed' && event.state === 'disconnected',
    );
    expect(errorIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeLessThan(disconnectedIndex);

    client.stallNextConnect(HRM);
    const stalled = client.connect(HRM);
    await advance(10_000);
    expect(client.connectionStateOf(HRM)).toBe('connecting');
    const cancelled = client.disconnect(HRM);
    await advance(10);
    await expect(stalled).rejects.toMatchObject({ code: 'disconnected' });
    await cancelled;

    const ok = client.connect(HRM);
    await advance(320);
    await ok;
    client.dropConnection(HRM);
    expect(events.at(-2)).toMatchObject({
      type: 'ble.error',
      deviceId: HRM,
      error: { code: 'disconnected' },
    });
    expect(client.connectionStateOf(HRM)).toBe('disconnected');
  });

  it('drops every link when the radio turns off', async () => {
    const { client, events, advance } = createClient({ connectStepMs: 100 });
    const connectCall = client.connect(HRM);
    await advance(320);
    await connectCall;
    client.setAdapterState('powered_off');
    expect(client.connectionStateOf(HRM)).toBe('disconnected');
    expect(
      events.some(event => event.type === 'ble.error' && event.deviceId === HRM),
    ).toBe(true);
    expect(events.at(-1)).toEqual({
      type: 'bluetooth.state_changed',
      state: 'powered_off',
    });
  });
});

describe('createMockBleClient', () => {
  it('answers state and permission reads after the simulated latency', async () => {
    const { client, advance } = createClient();
    const state = client.getBluetoothState();
    const permission = client.getPermissionState();
    await advance(10);
    await expect(state).resolves.toBe('powered_on');
    await expect(permission).resolves.toBe('granted');
  });

  it('grants permission on request when it was not decided yet', async () => {
    const { client, advance } = createClient({ initialPermissionState: 'not_requested' });
    const request = client.requestPermission();
    await advance(10);
    await expect(request).resolves.toBe('granted');
    client.setPermissionState('blocked');
    const blocked = client.requestPermission();
    await advance(10);
    await expect(blocked).resolves.toBe('blocked');
  });

  it('advertises every scripted peripheral with contract-valid payloads', async () => {
    const { client, events, advance } = createClient();
    const start = client.startScan();
    await advance(10);
    await start;
    expect(client.isScanning).toBe(true);

    const discovered = events.filter(event => event.type === 'scan.device_discovered');
    expect(discovered.map(event => event.device.id)).toEqual(
      defaultMockPeripherals.map(peripheral => peripheral.id),
    );
    for (const event of events) {
      expect(parseNativeBleEvent(event).ok).toBe(true);
    }
  });

  it('keeps advertising at each peripheral interval and drifts RSSI within bounds', async () => {
    const { client, events, advance } = createClient({ random: () => 0.9 });
    const startScanCall = client.startScan();
    await advance(10);
    await startScanCall;
    events.length = 0;
    await advance(3_000);

    const uart = events.filter(
      event =>
        event.type === 'scan.device_discovered' && event.device.id === 'MOCK-UART-0004',
    );
    expect(uart.length).toBe(10);
    const rssis = uart.map(event =>
      event.type === 'scan.device_discovered' ? event.device.rssi : undefined,
    );
    expect(Math.max(...(rssis as number[]))).toBeLessThanOrEqual(-58 + 4);
    expect(Math.min(...(rssis as number[]))).toBeGreaterThanOrEqual(-58 - 4);
  });

  it('honors a service UUID filter', async () => {
    const { client, events, advance } = createClient();
    const startScanCall = client.startScan({
      serviceUuids: [HEART_RATE_SERVICE.toLowerCase()],
    });
    await advance(10);
    await startScanCall;
    const ids = new Set(
      events.flatMap(event =>
        event.type === 'scan.device_discovered' ? [event.device.id] : [],
      ),
    );
    expect([...ids]).toEqual(['MOCK-HRM-0001']);
  });

  it('stops all advertisements on stopScan', async () => {
    const { client, events, advance, pending } = createClient();
    const startScanCall = client.startScan();
    await advance(10);
    await startScanCall;
    const stopScanCall = client.stopScan();
    await advance(10);
    await stopScanCall;
    expect(client.isScanning).toBe(false);
    expect(pending()).toBe(0);
    events.length = 0;
    await advance(5_000);
    expect(events).toEqual([]);
  });

  it('refuses to scan while the radio is off or permission is missing', async () => {
    const { client, advance } = createClient({ initialAdapterState: 'powered_off' });
    const off = client.startScan();
    await advance(10);
    await expect(off).rejects.toMatchObject({ code: 'bluetooth_powered_off' });

    client.setAdapterState('powered_on');
    client.setPermissionState('denied');
    const denied = client.startScan();
    await advance(10);
    await expect(denied).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('drops a running scan when the radio turns off, like the platform does', async () => {
    const { client, events, advance } = createClient();
    const startScanCall = client.startScan();
    await advance(10);
    await startScanCall;
    client.setAdapterState('powered_off');
    expect(events.at(-1)).toEqual({
      type: 'bluetooth.state_changed',
      state: 'powered_off',
    });
    expect(client.isScanning).toBe(false);
  });

  it('scripts start failures and running-scan failures', async () => {
    const { client, events, advance } = createClient();
    client.failNextScanStart(new BleError({ code: 'scan_failed', message: 'busy' }));
    const failed = client.startScan();
    await advance(10);
    await expect(failed).rejects.toMatchObject({ code: 'scan_failed', message: 'busy' });

    const startScanCall = client.startScan();
    await advance(10);
    await startScanCall;
    client.failRunningScan(
      new BleError({ code: 'scan_failed', message: 'registration' }),
    );
    expect(client.isScanning).toBe(false);
    expect(events.at(-1)).toEqual({
      type: 'ble.error',
      error: { code: 'scan_failed', message: 'registration' },
    });
  });
});
