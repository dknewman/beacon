import React from 'react';
import { App } from './App';
import { USE_MOCK_BLE_CLIENT } from './runtimeOptions';
import { createLazySessionRepository } from '../features/sessions/createLazySessionRepository';
import type { SessionRepository } from '../features/sessions/SessionRepository';
import {
  prepareSessionDatabase,
  SqliteSessionRepository,
} from '../features/sessions/SqliteSessionRepository';
import { createMockBleClient } from '../mock/createMockBleClient';
import type { BleClient } from '../native/BleClient';
import { createNativeBleClient } from '../native/createNativeBleClient';
import { createNativeExportClient } from '../native/createNativeExportClient';
import type { ExportClient } from '../native/ExportClient';
import NativeBeaconBluetooth from '../native/specs/NativeBeaconBluetooth';
import NativeBeaconExport from '../native/specs/NativeBeaconExport';
import { openAppDatabase } from '../storage/openAppDatabase';

/**
 * Composition root. This is the only place that touches the real Turbo Module
 * and the on-device database; everything below receives the typed client and
 * the repository through props/context so tests and the mock client can
 * substitute them without mocking modules.
 */
export function createRootComponent(): React.ComponentType {
  const bleClient = createBleClient();
  const sessionRepository = createSessionRepository();
  const exportClient: ExportClient = createNativeExportClient(NativeBeaconExport);

  function Root(): React.JSX.Element {
    return (
      <App
        bleClient={bleClient}
        sessionRepository={sessionRepository}
        exportClient={exportClient}
      />
    );
  }

  return Root;
}

function createBleClient(): BleClient {
  if (USE_MOCK_BLE_CLIENT) {
    return createMockBleClient();
  }
  return createNativeBleClient(NativeBeaconBluetooth);
}

/** Opens SQLite and runs migrations on first use; sessions are real even with the mock radio. */
function createSessionRepository(): SessionRepository {
  return createLazySessionRepository(async () => {
    const db = openAppDatabase();
    await prepareSessionDatabase(db);
    // Invalid rows are skipped rather than reported; a developer diagnostics
    // channel is not part of this milestone.
    return new SqliteSessionRepository(db);
  });
}
