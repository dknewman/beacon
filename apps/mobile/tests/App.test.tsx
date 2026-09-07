import React from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type {
  BleDevice,
  GattService,
  ScanDeviceDiscoveredEvent,
} from '@beacon/ble-contracts';
import { App } from '../src/app/App';
import { FakeBleClient } from './fakes/FakeBleClient';

const readiness = () => screen.getByTestId('bluetooth-readiness-value');
const adapterRow = () => screen.getByTestId('bluetooth-status-value');
const permissionRow = () => screen.getByTestId('permission-status-value');

/** Resolves both initial native reads so the screen leaves the checking state. */
async function settle(
  client: FakeBleClient,
  adapter = 'powered_on',
  permission = 'granted',
) {
  await act(async () => {
    client.resolveBluetoothState(adapter as never);
    client.resolvePermissionState(permission as never);
  });
}

/** Finds the foreground listener the permission hook registered on AppState. */
function appStateListener(): (state: AppStateStatus) => void {
  const call = jest
    .mocked(AppState.addEventListener)
    .mock.calls.find(([event]) => event === 'change');
  if (call === undefined) {
    throw new Error('No AppState change listener registered');
  }
  return call[1] as (state: AppStateStatus) => void;
}

beforeEach(() => {
  jest.clearAllMocks();
  // The preset's Linking mock returns undefined; the real API returns promises.
  jest.mocked(Linking.openSettings).mockResolvedValue(undefined);
  jest.mocked(Linking.sendIntent).mockResolvedValue(undefined);
});

describe('App (adapter + permission readiness)', () => {
  it('shows checking until both native reads resolve, then ready', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);

    expect(readiness()).toHaveTextContent('Checking');
    // Adapter hook, scan coordinator and connection coordinator each subscribe once.
    expect(client.listenerCount).toBe(3);
    expect(client.getBluetoothStateCalls).toBe(1);
    expect(client.getPermissionStateCalls).toBe(1);

    await settle(client);
    expect(readiness()).toHaveTextContent('Ready');
    expect(adapterRow()).toHaveTextContent('On');
    expect(permissionRow()).toHaveTextContent('Granted');
    expect(screen.queryByTestId('bluetooth-action')).toBeNull();
  });

  it('follows native adapter events without re-querying', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client);

    await act(async () => {
      client.emit({ type: 'bluetooth.state_changed', state: 'powered_off' });
    });
    expect(readiness()).toHaveTextContent('Bluetooth is off');
    expect(adapterRow()).toHaveTextContent('Off');
    expect(client.getBluetoothStateCalls).toBe(1);
  });

  it('asks for permission first, then reflects the prompt result', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    // iOS reports "unknown" until authorization is decided; permission still wins.
    await settle(client, 'unknown', 'not_requested');

    expect(readiness()).toHaveTextContent('Permission needed');
    const button = screen.getByTestId('bluetooth-action');
    expect(button).toHaveTextContent('Allow Bluetooth access');

    await fireEvent.press(button);
    expect(client.requestPermissionCalls).toBe(1);
    expect(permissionRow()).toHaveTextContent('Asking');
    expect(screen.getByTestId('bluetooth-action')).toBeDisabled();

    await act(async () => {
      client.resolvePermissionRequest('granted');
      client.emit({ type: 'bluetooth.state_changed', state: 'powered_on' });
    });
    expect(readiness()).toHaveTextContent('Ready');
    expect(permissionRow()).toHaveTextContent('Granted');
  });

  it('sends blocked permission to app settings', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client, 'powered_on', 'blocked');

    expect(readiness()).toHaveTextContent('Permission blocked');
    await fireEvent.press(screen.getByTestId('bluetooth-action'));
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(client.requestPermissionCalls).toBe(0);
  });

  it('offers Bluetooth settings when the radio is off', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client, 'powered_off', 'granted');

    expect(readiness()).toHaveTextContent('Bluetooth is off');
    await fireEvent.press(screen.getByTestId('bluetooth-action'));
    // Jest runs as iOS by default, where only the app settings page is reachable.
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('re-reads permission when the app returns to the foreground', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client, 'powered_on', 'blocked');
    expect(client.getPermissionStateCalls).toBe(1);

    await act(async () => {
      appStateListener()('active');
    });
    expect(client.getPermissionStateCalls).toBe(2);
    await act(async () => {
      client.resolvePermissionState('granted');
    });
    expect(readiness()).toHaveTextContent('Ready');
  });

  it('ignores a foreground re-check while a prompt is in flight', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client, 'powered_on', 'denied');

    await fireEvent.press(screen.getByTestId('bluetooth-action'));
    await act(async () => {
      appStateListener()('active');
    });
    expect(client.getPermissionStateCalls).toBe(1);
    expect(permissionRow()).toHaveTextContent('Asking');

    await act(async () => {
      client.resolvePermissionRequest('blocked');
    });
    expect(readiness()).toHaveTextContent('Permission blocked');
  });

  it('surfaces native failures with the error code and retries both reads', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);

    await act(async () => {
      client.rejectBluetoothState(
        Object.assign(new Error('Central unavailable'), { code: 'native_failure' }),
      );
      client.resolvePermissionState('granted');
    });
    expect(readiness()).toHaveTextContent('Error');
    expect(
      within(screen.getByTestId('bluetooth-readiness')).getByText(
        'Central unavailable (native_failure)',
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('bluetooth-action'));
    expect(readiness()).toHaveTextContent('Checking');
    expect(client.getBluetoothStateCalls).toBe(2);
    expect(client.getPermissionStateCalls).toBe(2);

    await settle(client);
    expect(readiness()).toHaveTextContent('Ready');
  });

  it('reports a failed permission request without losing the adapter state', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client, 'powered_on', 'not_requested');

    await fireEvent.press(screen.getByTestId('bluetooth-action'));
    await act(async () => {
      client.rejectPermissionRequest(
        Object.assign(new Error('No foreground activity'), { code: 'native_failure' }),
      );
    });
    expect(readiness()).toHaveTextContent('Error');
    expect(
      within(screen.getByTestId('bluetooth-readiness')).getByText(
        'No foreground activity (native_failure)',
      ),
    ).toBeOnTheScreen();
    expect(adapterRow()).toHaveTextContent('On');
  });

  it('surfaces adapter-level ble.error events from the bridge', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client);

    await act(async () => {
      client.emit({
        type: 'ble.error',
        error: { code: 'invalid_payload', message: 'Invalid native BLE event: state' },
      });
    });
    expect(readiness()).toHaveTextContent('Error');
    expect(screen.getByTestId('bluetooth-action')).toHaveTextContent('Retry');
  });

  it('exposes status rows as single accessible elements with text state', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client, 'powered_on', 'denied');
    expect(
      screen.getByLabelText(
        'Permission, Denied. Access was declined. You can ask again.',
      ),
    ).toBeOnTheScreen();
  });

  it('removes native subscriptions on unmount', async () => {
    const client = new FakeBleClient();
    const view = await render(<App bleClient={client} />);
    expect(client.listenerCount).toBe(3);
    await view.unmount();
    expect(client.listenerCount).toBe(0);
    // Late native responses after unmount must not throw or update state.
    await act(async () => {
      client.resolveBluetoothState('powered_on');
      client.resolvePermissionState('granted');
    });
  });
});

const scanButton = () => screen.getByTestId('scan-toggle');
/** Device rows only; the list itself carries testID "device-list". */
const deviceRows = () => screen.getAllByTestId(/^device-(?!list$)[a-z]+$/);
const summaryTitle = () => screen.getByTestId('scan-summary-title');
const summaryDetail = () => screen.getByTestId('scan-summary-detail');

function advertisement(
  id: string,
  overrides: Partial<BleDevice> = {},
): ScanDeviceDiscoveredEvent {
  return {
    type: 'scan.device_discovered',
    device: {
      id,
      serviceUuids: [],
      lastSeenAt: new Date(Date.now()).toISOString(),
      ...overrides,
    },
  };
}

/** Renders, settles readiness as ready, and starts a scan that native has accepted. */
async function renderScanning() {
  const client = new FakeBleClient();
  await render(<App bleClient={client} />);
  await settle(client);
  await fireEvent.press(scanButton());
  await act(async () => {
    client.resolveStartScan();
  });
  expect(scanButton()).toHaveTextContent('Stop scanning');
  return client;
}

describe('App (device scanning)', () => {
  it('keeps the scan control disabled until Bluetooth is ready', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    expect(scanButton()).toBeDisabled();
    await settle(client, 'powered_off', 'granted');
    expect(scanButton()).toBeDisabled();
    expect(summaryTitle()).toHaveTextContent('Nearby devices');
    expect(client.startScanCalls).toHaveLength(0);
  });

  it('starts, lists discovered devices without duplicates, updates RSSI, and stops', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client);

    await fireEvent.press(scanButton());
    expect(client.startScanCalls).toEqual([{ allowDuplicates: true }]);
    expect(scanButton()).toHaveTextContent('Starting…');
    expect(scanButton()).toBeDisabled();

    await act(async () => {
      client.resolveStartScan();
    });
    expect(scanButton()).toHaveTextContent('Stop scanning');
    expect(summaryDetail()).toHaveTextContent('Listening for advertisements…');

    await act(async () => {
      client.emit(advertisement('scale', { name: 'QN Scale', rssi: -47 }));
      client.emit(advertisement('omron', { localName: 'Omron HEM', rssi: -59 }));
      client.emit(advertisement('scale', { rssi: -49 }));
    });
    expect(deviceRows()).toHaveLength(2);
    expect(summaryTitle()).toHaveTextContent('Nearby devices (2)');
    expect(screen.getByTestId('device-scale-name')).toHaveTextContent('QN Scale');
    expect(screen.getByTestId('device-scale-rssi')).toHaveTextContent('-49 dBm');
    expect(screen.getByTestId('device-omron-name')).toHaveTextContent('Omron HEM');
    expect(screen.getByTestId('device-omron-seen')).toHaveTextContent('Last seen now');

    await fireEvent.press(scanButton());
    expect(client.stopScanCalls).toBe(1);
    expect(scanButton()).toHaveTextContent('Stopping…');
    await act(async () => {
      client.resolveStopScan();
    });
    expect(scanButton()).toHaveTextContent('Scan');
    expect(summaryDetail()).toHaveTextContent(/Scan stopped/);

    // Events after stop must not resurrect or add rows.
    await act(async () => {
      client.emit(advertisement('late', { name: 'Late', rssi: -40 }));
    });
    expect(screen.queryByTestId('device-late')).toBeNull();
    expect(deviceRows()).toHaveLength(2);
  });

  it('shows everything an advertisement carried', async () => {
    const client = await renderScanning();
    await act(async () => {
      client.emit(
        advertisement('hrm', {
          name: 'Polar H10',
          rssi: -55,
          connectable: true,
          manufacturerData: '6B000102030405060708',
          serviceUuids: [
            '0000180D-0000-1000-8000-00805F9B34FB',
            '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
          ],
        }),
      );
      client.emit(advertisement('anon', { rssi: -80, connectable: false }));
    });
    expect(screen.getByTestId('device-hrm-services')).toHaveTextContent(
      'Services: 180D, 6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
    );
    expect(screen.getByTestId('device-hrm-manufacturer')).toHaveTextContent(
      'Manufacturer: 6B 00 01 02 03 04 05 06 …',
    );
    expect(screen.getByTestId('device-hrm-seen')).toHaveTextContent(/Connectable/);
    expect(screen.getByTestId('device-anon-name')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('device-anon-seen')).toHaveTextContent(/Not connectable/);
    expect(screen.getByLabelText('Polar H10, -55 dBm, last seen now')).toBeOnTheScreen();
  });

  it('filters by name, service UUID and RSSI without touching the native scan', async () => {
    const client = await renderScanning();
    await act(async () => {
      client.emit(
        advertisement('hrm', {
          name: 'Polar H10',
          rssi: -55,
          serviceUuids: ['0000180D-0000-1000-8000-00805F9B34FB'],
        }),
      );
      client.emit(advertisement('scale', { name: 'QN Scale', rssi: -75 }));
    });
    expect(deviceRows()).toHaveLength(2);

    await fireEvent.changeText(screen.getByTestId('filter-name'), 'polar');
    expect(screen.queryByTestId('device-scale')).toBeNull();
    expect(screen.getByTestId('device-hrm')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('filter-name'), '');

    await fireEvent.changeText(screen.getByTestId('filter-service'), '180d');
    expect(screen.queryByTestId('device-scale')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('filter-service'), '');

    await fireEvent.press(screen.getByTestId('filter-rssi-60'));
    expect(screen.queryByTestId('device-scale')).toBeNull();
    expect(summaryDetail()).toHaveTextContent(
      '1 hidden by filters or not seen recently.',
    );
    await fireEvent.press(screen.getByTestId('filter-rssi-any'));
    expect(deviceRows()).toHaveLength(2);

    expect(client.startScanCalls).toHaveLength(1);
    expect(client.stopScanCalls).toBe(0);
  });

  it('hides devices that stop advertising and shows them again when they return', async () => {
    jest.useFakeTimers();
    try {
      const client = await renderScanning();
      await act(async () => {
        client.emit(advertisement('scale', { name: 'QN Scale', rssi: -47 }));
        client.emit(advertisement('tag', { name: 'Tag', rssi: -70 }));
      });
      expect(deviceRows()).toHaveLength(2);

      await act(async () => {
        jest.advanceTimersByTime(6_000);
        client.emit(advertisement('scale', { rssi: -48 }));
      });
      await act(async () => {
        jest.advanceTimersByTime(6_000);
      });
      expect(screen.getByTestId('device-scale')).toBeOnTheScreen();
      expect(screen.queryByTestId('device-tag')).toBeNull();
      expect(screen.getByTestId('device-scale-seen')).toHaveTextContent(
        'Last seen 6 s ago',
      );
      expect(summaryTitle()).toHaveTextContent('Nearby devices (1)');

      await act(async () => {
        client.emit(advertisement('tag', { rssi: -71 }));
      });
      expect(screen.getByTestId('device-tag')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops the scan when Bluetooth turns off mid-scan', async () => {
    const client = await renderScanning();
    await act(async () => {
      client.emit({ type: 'bluetooth.state_changed', state: 'powered_off' });
    });
    expect(client.stopScanCalls).toBe(1);
    expect(readiness()).toHaveTextContent('Bluetooth is off');
    await act(async () => {
      client.resolveStopScan();
    });
    expect(scanButton()).toHaveTextContent('Scan');
    expect(scanButton()).toBeDisabled();
  });

  it('reports a rejected start with its code and allows another attempt', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client);
    await fireEvent.press(scanButton());
    await act(async () => {
      client.rejectStartScan(
        Object.assign(new Error('Scanning too frequently'), { code: 'scan_failed' }),
      );
    });
    expect(summaryTitle()).toHaveTextContent('Scan failed');
    expect(summaryDetail()).toHaveTextContent('Scanning too frequently (scan_failed)');
    expect(scanButton()).toHaveTextContent('Scan again');
    expect(readiness()).toHaveTextContent('Ready');

    await fireEvent.press(scanButton());
    expect(client.startScanCalls).toHaveLength(2);
    expect(scanButton()).toHaveTextContent('Starting…');
  });

  it('routes native scan failures to the scan state, not the adapter', async () => {
    const client = await renderScanning();
    await act(async () => {
      client.emit({
        type: 'ble.error',
        error: {
          code: 'scan_failed',
          message: 'Scanner registration failed',
          nativeCode: '2',
        },
      });
    });
    expect(summaryTitle()).toHaveTextContent('Scan failed');
    expect(adapterRow()).toHaveTextContent('On');
    expect(readiness()).toHaveTextContent('Ready');
    expect(scanButton()).toHaveTextContent('Scan again');
  });

  it('waits for an in-flight start before stopping', async () => {
    const client = new FakeBleClient();
    await render(<App bleClient={client} />);
    await settle(client);
    await fireEvent.press(scanButton());
    // Stop requested while native has not acknowledged the start yet.
    await act(async () => {
      client.emit({ type: 'bluetooth.state_changed', state: 'powered_off' });
    });
    expect(client.stopScanCalls).toBe(0);
    await act(async () => {
      client.resolveStartScan();
    });
    expect(client.stopScanCalls).toBe(1);
    await act(async () => {
      client.resolveStopScan();
    });
    expect(scanButton()).toHaveTextContent('Scan');
  });

  it('stops an active scan on unmount', async () => {
    const client = new FakeBleClient();
    const view = await render(<App bleClient={client} />);
    await settle(client);
    await fireEvent.press(scanButton());
    await act(async () => {
      client.resolveStartScan();
    });
    await view.unmount();
    expect(client.stopScanCalls).toBe(1);
    expect(client.listenerCount).toBe(0);
  });
});

const connectionStatus = () => screen.getByTestId('connection-status-value');
const connectionAction = () => screen.getByTestId('connection-action');

/** Scans, discovers one device, and opens its detail screen. */
async function openDetail(id = 'scale', overrides: Partial<BleDevice> = {}) {
  const client = await renderScanning();
  await act(async () => {
    client.emit(advertisement(id, { name: 'QN Scale', rssi: -47, ...overrides }));
  });
  await fireEvent.press(screen.getByTestId(`device-${id}`));
  expect(screen.getByTestId('detail-title')).toHaveTextContent('QN Scale');
  return client;
}

describe('App (device detail and connection lifecycle)', () => {
  it('opens a device from the list and shows its advertisement data', async () => {
    const client = await openDetail('scale', {
      serviceUuids: ['0000181D-0000-1000-8000-00805F9B34FB'],
      manufacturerData: 'FFFF0A1B',
    });
    expect(screen.getByTestId('detail-id')).toHaveTextContent('scale');
    expect(connectionStatus()).toHaveTextContent('Disconnected');
    expect(screen.getByTestId('signal-value')).toHaveTextContent('-47 dBm');
    expect(screen.getByTestId('advertisement-value')).toHaveTextContent('Connectable');
    expect(screen.getByTestId('advertisement')).toHaveTextContent(/Services: 181D/);
    expect(screen.getByTestId('advertisement')).toHaveTextContent(
      /Manufacturer: FFFF0A1B/,
    );
    expect(connectionAction()).toHaveTextContent('Connect');
    expect(client.connectCalls).toEqual([]);

    // The scan keeps running underneath and the detail keeps following the cache.
    await act(async () => {
      client.emit(advertisement('scale', { rssi: -52 }));
    });
    expect(screen.getByTestId('signal-value')).toHaveTextContent('-52 dBm');
  });

  it('connects through every native transition and reads live RSSI when ready', async () => {
    jest.useFakeTimers();
    try {
      const client = await openDetail();
      await fireEvent.press(connectionAction());
      expect(client.connectCalls).toEqual(['scale']);
      expect(connectionStatus()).toHaveTextContent('Connecting');
      expect(connectionAction()).toHaveTextContent('Cancel');

      await act(async () => {
        client.emit({
          type: 'connection.state_changed',
          deviceId: 'scale',
          state: 'connecting',
        });
        client.emit({
          type: 'connection.state_changed',
          deviceId: 'scale',
          state: 'connected',
        });
      });
      expect(connectionStatus()).toHaveTextContent('Connected');
      expect(connectionAction()).toHaveTextContent('Disconnect');

      await act(async () => {
        client.emit({
          type: 'connection.state_changed',
          deviceId: 'scale',
          state: 'discovering_services',
        });
        client.emit({
          type: 'connection.state_changed',
          deviceId: 'scale',
          state: 'ready',
        });
        client.resolveConnect();
      });
      expect(connectionStatus()).toHaveTextContent('Ready');
      expect(client.readRssiCalls).toEqual(['scale']);
      await act(async () => {
        client.resolveRssi(-58);
      });
      expect(screen.getByTestId('signal-value')).toHaveTextContent('-58 dBm');
      expect(screen.getByTestId('signal')).toHaveTextContent(/live from the link/);

      await act(async () => {
        jest.advanceTimersByTime(3_000);
      });
      expect(client.readRssiCalls).toEqual(['scale', 'scale']);

      await fireEvent.press(connectionAction());
      expect(client.disconnectCalls).toEqual(['scale']);
      expect(connectionStatus()).toHaveTextContent('Disconnecting');
      expect(connectionAction()).toBeDisabled();
      await act(async () => {
        client.emit({
          type: 'connection.state_changed',
          deviceId: 'scale',
          state: 'disconnected',
        });
        client.resolveDisconnect();
      });
      expect(connectionStatus()).toHaveTextContent('Disconnected');
      expect(screen.getByTestId('connection-status')).toHaveTextContent(
        /Not connected to this device/,
      );
      // Polling stops with the link; the advertisement RSSI is shown again.
      expect(screen.getByTestId('signal-value')).toHaveTextContent('-47 dBm');
      await act(async () => {
        jest.advanceTimersByTime(6_000);
      });
      expect(client.readRssiCalls).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels an attempt in progress', async () => {
    const client = await openDetail();
    await fireEvent.press(connectionAction());
    await fireEvent.press(connectionAction());
    expect(client.disconnectCalls).toEqual(['scale']);
    expect(connectionStatus()).toHaveTextContent('Disconnecting');
    await act(async () => {
      client.emit({
        type: 'connection.state_changed',
        deviceId: 'scale',
        state: 'disconnected',
      });
      client.rejectConnect(
        Object.assign(new Error('Connection cancelled'), { code: 'disconnected' }),
      );
      client.resolveDisconnect();
    });
    expect(connectionStatus()).toHaveTextContent('Disconnected');
    expect(screen.getByTestId('connection-status')).toHaveTextContent(
      /Not connected to this device/,
    );
  });

  it('times out a stalled attempt, cancels it natively and offers a retry', async () => {
    jest.useFakeTimers();
    try {
      const client = await openDetail();
      await fireEvent.press(connectionAction());
      await act(async () => {
        client.emit({
          type: 'connection.state_changed',
          deviceId: 'scale',
          state: 'connecting',
        });
      });
      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      expect(connectionStatus()).toHaveTextContent('Failed');
      expect(screen.getByTestId('connection-status')).toHaveTextContent(
        /No connection after 15 s \(connection_timeout\)/,
      );
      expect(client.disconnectCalls).toEqual(['scale']);
      expect(connectionAction()).toHaveTextContent('Try again');

      await act(async () => {
        client.emit({
          type: 'connection.state_changed',
          deviceId: 'scale',
          state: 'disconnected',
        });
        client.rejectConnect(
          Object.assign(new Error('cancelled'), { code: 'disconnected' }),
        );
        client.resolveDisconnect();
      });
      expect(connectionStatus()).toHaveTextContent('Disconnected');
      expect(screen.getByTestId('connection-status')).toHaveTextContent(
        /connection_timeout/,
      );

      await fireEvent.press(connectionAction());
      expect(client.connectCalls).toEqual(['scale', 'scale']);
      expect(connectionStatus()).toHaveTextContent('Connecting');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a native connection failure with its code', async () => {
    const client = await openDetail();
    await fireEvent.press(connectionAction());
    await act(async () => {
      client.emit({
        type: 'ble.error',
        deviceId: 'scale',
        error: {
          code: 'connection_failed',
          message: 'GATT error 133',
          nativeCode: '133',
        },
      });
      client.emit({
        type: 'connection.state_changed',
        deviceId: 'scale',
        state: 'disconnected',
      });
      client.rejectConnect(
        Object.assign(new Error('GATT error 133'), { code: 'connection_failed' }),
      );
    });
    expect(connectionStatus()).toHaveTextContent('Disconnected');
    expect(screen.getByTestId('connection-status')).toHaveTextContent(
      /GATT error 133 \(connection_failed\)/,
    );
    expect(connectionAction()).toHaveTextContent('Connect');
    expect(connectionAction()).toBeEnabled();
    expect(screen.queryByTestId('detail-hint')).toBeNull();
  });

  it('shows a remote disconnect and keeps the reason', async () => {
    const client = await openDetail();
    await fireEvent.press(connectionAction());
    await act(async () => {
      client.emitConnected('scale');
      client.resolveConnect();
    });
    expect(connectionStatus()).toHaveTextContent('Ready');

    await act(async () => {
      client.emit({
        type: 'ble.error',
        deviceId: 'scale',
        error: { code: 'disconnected', message: 'The peripheral closed the connection' },
      });
    });
    expect(connectionStatus()).toHaveTextContent('Failed');
    await act(async () => {
      client.emit({
        type: 'connection.state_changed',
        deviceId: 'scale',
        state: 'disconnected',
      });
    });
    expect(connectionStatus()).toHaveTextContent('Disconnected');
    expect(screen.getByTestId('connection-status')).toHaveTextContent(
      /peripheral closed the connection \(disconnected\)/,
    );
  });

  it('disables connecting while Bluetooth is not ready and survives navigating back', async () => {
    const client = await openDetail();
    await act(async () => {
      client.emit({ type: 'bluetooth.state_changed', state: 'powered_off' });
    });
    expect(connectionAction()).toBeDisabled();
    expect(screen.getByTestId('detail-hint')).toHaveTextContent(/Turn on Bluetooth/);

    await act(async () => {
      client.resolveStopScan();
    });
    await fireEvent.press(screen.getByTestId('detail-back'));
    expect(screen.queryByTestId('device-detail')).toBeNull();
    expect(readiness()).toHaveTextContent('Bluetooth is off');
    // The device list keeps the last scan's rows and the radio guidance.
    expect(screen.getByTestId('device-scale')).toBeOnTheScreen();
  });

  it('shows the connection badge on the list row', async () => {
    const client = await openDetail();
    await fireEvent.press(connectionAction());
    await act(async () => {
      client.emitConnected('scale');
      client.resolveConnect();
    });
    await fireEvent.press(screen.getByTestId('detail-back'));
    expect(screen.getByTestId('device-scale-seen')).toHaveTextContent(/Connected/);
  });
});

const heartRateTable: GattService[] = [
  {
    uuid: '00001800-0000-1000-8000-00805F9B34FB',
    primary: true,
    characteristics: [
      {
        serviceUuid: '00001800-0000-1000-8000-00805F9B34FB',
        uuid: '00002A00-0000-1000-8000-00805F9B34FB',
        properties: ['read'],
      },
    ],
  },
  {
    uuid: '0000180D-0000-1000-8000-00805F9B34FB',
    primary: true,
    characteristics: [
      {
        serviceUuid: '0000180D-0000-1000-8000-00805F9B34FB',
        uuid: '00002A37-0000-1000-8000-00805F9B34FB',
        properties: ['notify'],
      },
      {
        serviceUuid: '0000180D-0000-1000-8000-00805F9B34FB',
        uuid: '00002A39-0000-1000-8000-00805F9B34FB',
        properties: ['write', 'write_without_response'],
      },
    ],
  },
  { uuid: '0000FFF0-0000-1000-8000-00805F9B34FB', primary: false, characteristics: [] },
];

/** Opens the detail screen and brings the connection to ready. */
async function openConnected() {
  const client = await openDetail();
  await fireEvent.press(connectionAction());
  await act(async () => {
    client.emitConnected('scale');
    client.resolveConnect();
  });
  expect(connectionStatus()).toHaveTextContent('Ready');
  return client;
}

describe('App (GATT discovery)', () => {
  it('fetches the table once the link is ready and shows the service count', async () => {
    const client = await openConnected();
    expect(client.discoverServicesCalls).toEqual(['scale']);
    expect(screen.getByTestId('services-value')).toHaveTextContent('Discovering');
    await act(async () => {
      client.resolveServices(heartRateTable);
    });
    expect(screen.getByTestId('services-value')).toHaveTextContent('3');
    expect(screen.getByTestId('services')).toHaveTextContent(
      /3 characteristics across 3 services/,
    );
    expect(screen.getByTestId('inspect-gatt')).toBeOnTheScreen();
  });

  it('shows services with names and characteristics with properties in the inspector', async () => {
    const client = await openConnected();
    await act(async () => {
      client.resolveServices(heartRateTable);
    });
    await fireEvent.press(screen.getByTestId('inspect-gatt'));
    expect(screen.getByTestId('gatt-inspector')).toBeOnTheScreen();
    // The table is shared with the detail screen: no second native call.
    expect(client.discoverServicesCalls).toEqual(['scale']);

    expect(screen.getByTestId('service-1800-name')).toHaveTextContent('Generic Access');
    expect(screen.getByTestId('service-180D-name')).toHaveTextContent('Heart Rate');
    expect(screen.getByTestId('service-FFF0-name')).toHaveTextContent(
      'Unknown secondary service',
    );
    expect(screen.getByTestId('service-FFF0-code')).toHaveTextContent(/secondary/);
    expect(screen.getByTestId('characteristic-2A37')).toHaveTextContent(
      /Heart Rate Measurement/,
    );
    expect(screen.getByTestId('characteristic-2A37-properties')).toHaveTextContent(
      'Notify',
    );
    expect(screen.getByTestId('characteristic-2A39-properties')).toHaveTextContent(
      'Write, Write without response',
    );

    await fireEvent.press(screen.getByTestId('characteristic-2A37'));
    expect(screen.getByTestId('characteristic-title')).toHaveTextContent(
      'Heart Rate Measurement',
    );
    expect(screen.getByTestId('characteristic-code')).toHaveTextContent('2A37');
    expect(screen.getByTestId('characteristic-service-value')).toHaveTextContent(
      'Heart Rate',
    );
    expect(screen.getByTestId('characteristic-properties-value')).toHaveTextContent(
      'Notify',
    );
    expect(screen.getByTestId('characteristic-properties')).toHaveTextContent(
      /pushes updates/,
    );
    expect(screen.getByTestId('characteristic-value-value')).toHaveTextContent(
      'Not read yet',
    );
    // Notify-only: no read control and no write form until M6 adds subscriptions.
    expect(screen.queryByTestId('characteristic-read')).toBeNull();
    expect(screen.queryByTestId('write-form')).toBeNull();

    await fireEvent.press(screen.getByTestId('characteristic-back'));
    expect(screen.getByTestId('gatt-inspector')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('gatt-back'));
    expect(screen.getByTestId('device-detail')).toBeOnTheScreen();
  });

  it('reports a failed discovery with its code and retries from the inspector', async () => {
    const client = await openConnected();
    await act(async () => {
      client.rejectServices(
        Object.assign(new Error('Service discovery failed (status 129)'), {
          code: 'service_not_found',
        }),
      );
    });
    expect(screen.getByTestId('services-value')).toHaveTextContent('Unavailable');
    await fireEvent.press(screen.getByTestId('inspect-gatt'));
    expect(screen.getByTestId('gatt-status-value')).toHaveTextContent('Failed');
    expect(screen.getByTestId('gatt-status')).toHaveTextContent(/service_not_found/);

    await fireEvent.press(screen.getByTestId('gatt-retry'));
    expect(client.discoverServicesCalls).toEqual(['scale', 'scale']);
    expect(screen.getByTestId('gatt-status-value')).toHaveTextContent('Discovering');
    await act(async () => {
      client.resolveServices([]);
    });
    expect(screen.getByTestId('gatt-status-value')).toHaveTextContent('No services');
  });

  it('drops the table when the link ends and discovers again on reconnect', async () => {
    const client = await openConnected();
    await act(async () => {
      client.resolveServices(heartRateTable);
    });
    expect(screen.getByTestId('services-value')).toHaveTextContent('3');

    await act(async () => {
      client.emit({
        type: 'ble.error',
        deviceId: 'scale',
        error: { code: 'disconnected', message: 'The peripheral closed the connection' },
      });
      client.emit({
        type: 'connection.state_changed',
        deviceId: 'scale',
        state: 'disconnected',
      });
    });
    expect(screen.getByTestId('services-value')).toHaveTextContent('—');
    expect(screen.queryByTestId('inspect-gatt')).toBeNull();

    await fireEvent.press(connectionAction());
    await act(async () => {
      client.emitConnected('scale');
      client.resolveConnect();
    });
    expect(client.discoverServicesCalls).toEqual(['scale', 'scale']);
  });
});

/** Connects, resolves the heart-rate table and opens one characteristic. */
async function openCharacteristic(shortUuid: '2A00' | '2A39') {
  const client = await openConnected();
  await act(async () => {
    client.resolveServices(heartRateTable);
  });
  await fireEvent.press(screen.getByTestId('inspect-gatt'));
  await fireEvent.press(screen.getByTestId(`characteristic-${shortUuid}`));
  expect(screen.getByTestId('characteristic-code')).toHaveTextContent(shortUuid);
  return client;
}

const GENERIC_ACCESS = '00001800-0000-1000-8000-00805F9B34FB';
const DEVICE_NAME = '00002A00-0000-1000-8000-00805F9B34FB';
const HEART_RATE = '0000180D-0000-1000-8000-00805F9B34FB';
const HR_CONTROL_POINT = '00002A39-0000-1000-8000-00805F9B34FB';

describe('App (characteristic read and write)', () => {
  it('reads a characteristic, shows every column and logs the packet', async () => {
    const client = await openCharacteristic('2A00');
    expect(screen.queryByTestId('write-form')).toBeNull();
    expect(screen.getByTestId('packet-list-empty')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('characteristic-read'));
    expect(client.readCalls).toEqual([
      { deviceId: 'scale', serviceUuid: GENERIC_ACCESS, characteristicUuid: DEVICE_NAME },
    ]);
    expect(screen.getByTestId('characteristic-read')).toHaveTextContent('Reading…');
    expect(screen.getByTestId('characteristic-read')).toBeDisabled();
    expect(screen.getByTestId('operation-status-value')).toHaveTextContent('Reading…');
    // A second press while in flight must not reach native.
    await fireEvent.press(screen.getByTestId('characteristic-read'));
    expect(client.readCalls).toHaveLength(1);

    await act(async () => {
      client.resolveRead([0x51, 0x4e, 0x2d, 0xc3, 0xa9]);
    });
    expect(screen.getByTestId('characteristic-read')).toHaveTextContent('Read');
    expect(screen.getByTestId('characteristic-read')).toBeEnabled();
    expect(screen.getByTestId('operation-status-value')).toHaveTextContent('Read');
    expect(screen.getByTestId('operation-status')).toHaveTextContent(/Read 5 bytes\./);
    expect(screen.getByTestId('characteristic-value-source')).toHaveTextContent(
      /^Read at \d\d:\d\d:\d\d\.\d\d\d · 5 bytes$/,
    );
    expect(screen.getByTestId('value-hex')).toHaveTextContent('51 4E 2D C3 A9');
    expect(screen.getByTestId('value-decimal')).toHaveTextContent('81 78 45 195 169');
    expect(screen.getByTestId('value-binary')).toHaveTextContent(
      '01010001 01001110 00101101 11000011 10101001',
    );
    expect(screen.getByTestId('value-ascii')).toHaveTextContent('QN-..');
    expect(screen.getByTestId('value-utf8')).toHaveTextContent('QN-é');
    expect(screen.getByTestId('packet-0')).toHaveTextContent(/Incoming/);
    expect(screen.getByTestId('packet-0-hex')).toHaveTextContent('51 4E 2D C3 A9');
    expect(screen.queryByTestId('packet-list-empty')).toBeNull();

    await act(async () => {
      client.resolveRead([0xff]);
    });
    // Late duplicate resolution has nothing pending; nothing changes.
    expect(screen.getByTestId('value-hex')).toHaveTextContent('51 4E 2D C3 A9');

    await fireEvent.press(screen.getByTestId('characteristic-read'));
    await act(async () => {
      client.resolveRead([0xff, 0xfe]);
    });
    expect(screen.getByTestId('value-hex')).toHaveTextContent('FF FE');
    expect(screen.getByTestId('value-utf8')).toHaveTextContent('Not valid UTF-8');
    expect(screen.getByTestId('packet-list')).toHaveTextContent(/Packets \(2\)/);
    expect(screen.getByTestId('packet-0-hex')).toHaveTextContent('FF FE');
    expect(screen.getByTestId('packet-1-hex')).toHaveTextContent('51 4E 2D C3 A9');
  });

  it('reports a failed read with its code and keeps the previous value', async () => {
    const client = await openCharacteristic('2A00');
    await fireEvent.press(screen.getByTestId('characteristic-read'));
    await act(async () => {
      client.resolveRead([0x01]);
    });
    await fireEvent.press(screen.getByTestId('characteristic-read'));
    await act(async () => {
      client.rejectRead(
        Object.assign(new Error('GATT status 2 (read not permitted)'), {
          code: 'read_failed',
        }),
      );
    });
    expect(screen.getByTestId('operation-status-value')).toHaveTextContent('Read failed');
    expect(screen.getByTestId('operation-status')).toHaveTextContent(
      /GATT status 2 \(read not permitted\) \(read_failed\)/,
    );
    expect(screen.getByTestId('characteristic-read')).toBeEnabled();
    expect(screen.getByTestId('value-hex')).toHaveTextContent('01');
    expect(screen.getByTestId('packet-list')).toHaveTextContent(/Packets \(1\)/);
  });

  it('validates write input per mode and writes with or without response', async () => {
    const client = await openCharacteristic('2A39');
    expect(screen.queryByTestId('characteristic-read')).toBeNull();
    const withResponse = () => screen.getByTestId('write-with-response');
    const withoutResponse = () => screen.getByTestId('write-without-response');
    const feedback = () => screen.getByTestId('write-feedback');

    expect(feedback()).toHaveTextContent('Enter a value to write.');
    expect(withResponse()).toBeDisabled();
    expect(withoutResponse()).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('write-input'), '02 9G');
    expect(feedback()).toHaveTextContent('"G" is not a hex digit.');
    expect(withResponse()).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('write-input'), '02 9a 1c');
    expect(feedback()).toHaveTextContent('3 bytes: 02 9A 1C');
    expect(withResponse()).toBeEnabled();

    await fireEvent.press(withResponse());
    expect(client.writeCalls).toEqual([
      {
        deviceId: 'scale',
        serviceUuid: HEART_RATE,
        characteristicUuid: HR_CONTROL_POINT,
        bytes: [0x02, 0x9a, 0x1c],
        mode: 'with_response',
      },
    ]);
    expect(withResponse()).toHaveTextContent('Writing…');
    expect(withResponse()).toBeDisabled();
    expect(withoutResponse()).toBeDisabled();
    await act(async () => {
      client.resolveWrite();
    });
    expect(screen.getByTestId('operation-status-value')).toHaveTextContent('Written');
    expect(screen.getByTestId('operation-status')).toHaveTextContent(
      /Wrote 3 bytes with response\./,
    );
    expect(screen.getByTestId('characteristic-value-source')).toHaveTextContent(
      /^Written at/,
    );
    expect(screen.getByTestId('value-hex')).toHaveTextContent('02 9A 1C');
    expect(screen.getByTestId('packet-0')).toHaveTextContent(/Outgoing/);
    // The input keeps its text so the same value can be sent again.
    expect(screen.getByTestId('write-input').props.value).toBe('02 9a 1c');

    await fireEvent.press(screen.getByTestId('write-mode-decimal'));
    // The text is re-parsed under the new mode rather than silently kept.
    expect(feedback()).toHaveTextContent('"9a" is not a whole number.');
    await fireEvent.changeText(screen.getByTestId('write-input'), '1 256');
    expect(feedback()).toHaveTextContent('256 is above 255; each value is one byte.');
    expect(withoutResponse()).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('write-input'), '1 255');
    expect(feedback()).toHaveTextContent('2 bytes: 01 FF');

    await fireEvent.press(screen.getByTestId('write-mode-utf8'));
    await fireEvent.changeText(screen.getByTestId('write-input'), 'Hi');
    expect(feedback()).toHaveTextContent('2 bytes: 48 69');
    await fireEvent.press(withoutResponse());
    expect(client.writeCalls[1]).toEqual({
      deviceId: 'scale',
      serviceUuid: HEART_RATE,
      characteristicUuid: HR_CONTROL_POINT,
      bytes: [0x48, 0x69],
      mode: 'without_response',
    });
    await act(async () => {
      client.resolveWrite();
    });
    expect(screen.getByTestId('operation-status')).toHaveTextContent(
      /Wrote 2 bytes without response\./,
    );
    expect(screen.getByTestId('value-utf8')).toHaveTextContent('Hi');
    expect(screen.getByTestId('packet-list')).toHaveTextContent(/Packets \(2\)/);
  });

  it('reports a failed write with its code', async () => {
    const client = await openCharacteristic('2A39');
    await fireEvent.changeText(screen.getByTestId('write-input'), '01');
    await fireEvent.press(screen.getByTestId('write-with-response'));
    await act(async () => {
      client.rejectWrite(
        Object.assign(new Error('GATT status 3 (write not permitted)'), {
          code: 'write_failed',
        }),
      );
    });
    expect(screen.getByTestId('operation-status-value')).toHaveTextContent(
      'Write failed',
    );
    expect(screen.getByTestId('operation-status')).toHaveTextContent(/\(write_failed\)/);
    expect(screen.getByTestId('write-with-response')).toBeEnabled();
    expect(screen.getByTestId('characteristic-value-value')).toHaveTextContent(
      'Not read yet',
    );
    expect(screen.getByTestId('packet-list-empty')).toBeOnTheScreen();
  });

  it('disables reads and writes when the link drops and keeps the packet history', async () => {
    const client = await openCharacteristic('2A00');
    await fireEvent.press(screen.getByTestId('characteristic-read'));
    await act(async () => {
      client.resolveRead([0x2a]);
    });
    expect(screen.queryByTestId('characteristic-hint')).toBeNull();

    await act(async () => {
      client.emit({
        type: 'ble.error',
        deviceId: 'scale',
        error: { code: 'disconnected', message: 'The peripheral closed the connection' },
      });
      client.emit({
        type: 'connection.state_changed',
        deviceId: 'scale',
        state: 'disconnected',
      });
    });
    // The table is gone with the link, so the read control goes with it and the reason shows.
    expect(screen.queryByTestId('characteristic-read')).toBeNull();
    expect(screen.getByTestId('characteristic-properties-value')).toHaveTextContent(
      'Not connected',
    );
    expect(screen.getByTestId('value-hex')).toHaveTextContent('2A');
    expect(screen.getByTestId('packet-list')).toHaveTextContent(/Packets \(1\)/);
  });

  it('shows the reason while a read is in flight when the link drops', async () => {
    const client = await openCharacteristic('2A00');
    await fireEvent.press(screen.getByTestId('characteristic-read'));
    await act(async () => {
      client.emit({
        type: 'ble.error',
        deviceId: 'scale',
        error: { code: 'disconnected', message: 'The peripheral closed the connection' },
      });
      client.emit({
        type: 'connection.state_changed',
        deviceId: 'scale',
        state: 'disconnected',
      });
      client.rejectRead(
        Object.assign(new Error('Not connected to scale'), { code: 'disconnected' }),
      );
    });
    expect(screen.getByTestId('operation-status-value')).toHaveTextContent('Read failed');
    expect(screen.getByTestId('operation-status')).toHaveTextContent(/\(disconnected\)/);
  });
});
