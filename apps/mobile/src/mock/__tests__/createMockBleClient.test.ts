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
