import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/app/App';
import { FakeBluetoothAdapterClient } from './fakes/FakeBluetoothAdapterClient';

describe('App (M0 adapter status)', () => {
  it('shows a loading state, then the adapter state reported by native', async () => {
    const client = new FakeBluetoothAdapterClient();
    await render(<App bleClient={client} />);

    expect(screen.getByTestId('bluetooth-status-value')).toHaveTextContent('Checking');
    expect(client.listenerCount).toBe(1);

    await act(async () => {
      client.resolveState('powered_on');
    });
    expect(screen.getByTestId('bluetooth-status-value')).toHaveTextContent('On');
    expect(screen.getByText('Bluetooth is on and ready to scan.')).toBeOnTheScreen();
  });

  it('follows native state change events without re-querying', async () => {
    const client = new FakeBluetoothAdapterClient();
    await render(<App bleClient={client} />);
    await act(async () => {
      client.resolveState('powered_on');
    });

    await act(async () => {
      client.emit({ type: 'bluetooth.state_changed', state: 'powered_off' });
    });
    expect(screen.getByTestId('bluetooth-status-value')).toHaveTextContent('Off');
    expect(client.getBluetoothStateCalls).toBe(1);
  });

  it('surfaces native failures with the error code and allows retry', async () => {
    const client = new FakeBluetoothAdapterClient();
    await render(<App bleClient={client} />);

    await act(async () => {
      client.rejectState(
        Object.assign(new Error('Central unavailable'), { code: 'native_failure' }),
      );
    });
    expect(screen.getByTestId('bluetooth-status-value')).toHaveTextContent('Error');
    expect(screen.getByText('Central unavailable (native_failure)')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('bluetooth-retry'));
    expect(screen.getByTestId('bluetooth-status-value')).toHaveTextContent('Checking');
    expect(client.getBluetoothStateCalls).toBe(2);

    await act(async () => {
      client.resolveState('powered_on');
    });
    expect(screen.getByTestId('bluetooth-status-value')).toHaveTextContent('On');
  });

  it('surfaces adapter-level ble.error events from the bridge', async () => {
    const client = new FakeBluetoothAdapterClient();
    await render(<App bleClient={client} />);
    await act(async () => {
      client.resolveState('powered_on');
    });

    await act(async () => {
      client.emit({
        type: 'ble.error',
        error: { code: 'invalid_payload', message: 'Invalid native BLE event: state' },
      });
    });
    expect(screen.getByTestId('bluetooth-status-value')).toHaveTextContent('Error');
    expect(screen.getByTestId('bluetooth-retry')).toBeOnTheScreen();
  });

  it('exposes the status row as a single accessible element with text state', async () => {
    const client = new FakeBluetoothAdapterClient();
    await render(<App bleClient={client} />);
    await act(async () => {
      client.resolveState('unauthorized');
    });
    expect(
      screen.getByLabelText(
        'Bluetooth, Not allowed. Beacon does not have permission to use Bluetooth.',
      ),
    ).toBeOnTheScreen();
  });

  it('removes the native subscription on unmount', async () => {
    const client = new FakeBluetoothAdapterClient();
    const view = await render(<App bleClient={client} />);
    expect(client.listenerCount).toBe(1);
    await view.unmount();
    expect(client.listenerCount).toBe(0);
    // A late native response after unmount must not throw or update state.
    await act(async () => {
      client.resolveState('powered_on');
    });
  });
});
