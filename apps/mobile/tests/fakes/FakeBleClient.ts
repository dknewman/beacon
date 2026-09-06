import type {
  BlePermissionState,
  BluetoothState,
  NativeBleEvent,
  Unsubscribe,
} from '@beacon/ble-contracts';
import type { BleClient } from '../../src/native/BleClient';

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/**
 * Deterministic in-memory stand-in for the native bridge, used by component
 * and integration tests. Every native call stays pending until the test
 * resolves or rejects it, so ordering and in-flight states can be asserted.
 * The full MockBleClient (scanning, GATT, failure scenarios) arrives in M10.
 */
export class FakeBleClient implements BleClient {
  private readonly listeners = new Set<(event: NativeBleEvent) => void>();
  private pendingBluetoothState: Deferred<BluetoothState>[] = [];
  private pendingPermissionState: Deferred<BlePermissionState>[] = [];
  private pendingPermissionRequest: Deferred<BlePermissionState>[] = [];

  getBluetoothStateCalls = 0;
  getPermissionStateCalls = 0;
  requestPermissionCalls = 0;

  getBluetoothState(): Promise<BluetoothState> {
    this.getBluetoothStateCalls += 1;
    return new Promise((resolve, reject) => {
      this.pendingBluetoothState.push({ resolve, reject });
    });
  }

  getPermissionState(): Promise<BlePermissionState> {
    this.getPermissionStateCalls += 1;
    return new Promise((resolve, reject) => {
      this.pendingPermissionState.push({ resolve, reject });
    });
  }

  requestPermission(): Promise<BlePermissionState> {
    this.requestPermissionCalls += 1;
    return new Promise((resolve, reject) => {
      this.pendingPermissionRequest.push({ resolve, reject });
    });
  }

  subscribe(listener: (event: NativeBleEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  resolveBluetoothState(state: BluetoothState): void {
    settle(this.takeBluetoothState(), d => d.resolve(state));
  }

  rejectBluetoothState(error: unknown): void {
    settle(this.takeBluetoothState(), d => d.reject(error));
  }

  resolvePermissionState(state: BlePermissionState): void {
    settle(this.takePermissionState(), d => d.resolve(state));
  }

  rejectPermissionState(error: unknown): void {
    settle(this.takePermissionState(), d => d.reject(error));
  }

  resolvePermissionRequest(state: BlePermissionState): void {
    settle(this.takePermissionRequest(), d => d.resolve(state));
  }

  rejectPermissionRequest(error: unknown): void {
    settle(this.takePermissionRequest(), d => d.reject(error));
  }

  emit(event: NativeBleEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  private takeBluetoothState(): Deferred<BluetoothState>[] {
    const pending = this.pendingBluetoothState;
    this.pendingBluetoothState = [];
    return pending;
  }

  private takePermissionState(): Deferred<BlePermissionState>[] {
    const pending = this.pendingPermissionState;
    this.pendingPermissionState = [];
    return pending;
  }

  private takePermissionRequest(): Deferred<BlePermissionState>[] {
    const pending = this.pendingPermissionRequest;
    this.pendingPermissionRequest = [];
    return pending;
  }
}

function settle<T>(
  deferreds: Deferred<T>[],
  apply: (deferred: Deferred<T>) => void,
): void {
  deferreds.forEach(apply);
}
