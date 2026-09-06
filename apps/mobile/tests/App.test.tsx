import React from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { BleDevice, ScanDeviceDiscoveredEvent } from '@beacon/ble-contracts';
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
    // One subscription for the adapter hook, one for the scan coordinator.
    expect(client.listenerCount).toBe(2);
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
    expect(client.listenerCount).toBe(2);
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
