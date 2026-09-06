import React from 'react';
import { App } from './App';
import { USE_MOCK_BLE_CLIENT } from './runtimeOptions';
import { createMockBleClient } from '../mock/createMockBleClient';
import type { BleClient } from '../native/BleClient';
import { createNativeBleClient } from '../native/createNativeBleClient';
import NativeBeaconBluetooth from '../native/specs/NativeBeaconBluetooth';

/**
 * Composition root. This is the only place that touches the real Turbo Module;
 * everything below receives the typed client through props/context so tests
 * and the mock client can substitute it without mocking modules.
 */
export function createRootComponent(): React.ComponentType {
  const bleClient = createBleClient();

  function Root(): React.JSX.Element {
    return <App bleClient={bleClient} />;
  }

  return Root;
}

function createBleClient(): BleClient {
  if (USE_MOCK_BLE_CLIENT) {
    return createMockBleClient();
  }
  return createNativeBleClient(NativeBeaconBluetooth);
}
