import React from 'react';
import { App } from './App';
import { createNativeBleClient } from '../native/createNativeBleClient';
import NativeBeaconBluetooth from '../native/specs/NativeBeaconBluetooth';

/**
 * Composition root. This is the only place that touches the real Turbo Module;
 * everything below receives the typed client through props/context so tests and
 * the future MockBleClient (M10) can substitute it without mocking modules.
 */
export function createRootComponent(): React.ComponentType {
  const bleClient = createNativeBleClient(NativeBeaconBluetooth);

  function Root(): React.JSX.Element {
    return <App bleClient={bleClient} />;
  }

  return Root;
}
