import React from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
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
    expect(client.listenerCount).toBe(1);
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
    expect(client.listenerCount).toBe(1);
    await view.unmount();
    expect(client.listenerCount).toBe(0);
    // Late native responses after unmount must not throw or update state.
    await act(async () => {
      client.resolveBluetoothState('powered_on');
      client.resolvePermissionState('granted');
    });
  });
});
