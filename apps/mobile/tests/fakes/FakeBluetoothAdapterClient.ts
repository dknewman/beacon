import type {
  BluetoothAdapterApi,
  BluetoothState,
  NativeBleEvent,
  Unsubscribe,
} from '@beacon/ble-contracts';

/**
 * Deterministic in-memory stand-in for the native bridge, used by component
 * and integration tests. The full MockBleClient (scanning, GATT, failure
 * scenarios) is delivered in M10; this fake covers the adapter segment only.
 */
export class FakeBluetoothAdapterClient implements BluetoothAdapterApi {
  private readonly listeners = new Set<(event: NativeBleEvent) => void>();
  private pending: Array<{
    resolve: (state: BluetoothState) => void;
    reject: (error: unknown) => void;
  }> = [];

  getBluetoothStateCalls = 0;

  getBluetoothState(): Promise<BluetoothState> {
    this.getBluetoothStateCalls += 1;
    return new Promise<BluetoothState>((resolve, reject) => {
      this.pending.push({ resolve, reject });
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

  /** Resolves every outstanding getBluetoothState() call. */
  resolveState(state: BluetoothState): void {
    const pending = this.pending;
    this.pending = [];
    pending.forEach(p => p.resolve(state));
  }

  rejectState(error: unknown): void {
    const pending = this.pending;
    this.pending = [];
    pending.forEach(p => p.reject(error));
  }

  emit(event: NativeBleEvent): void {
    this.listeners.forEach(listener => listener(event));
  }
}
