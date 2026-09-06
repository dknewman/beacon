import type {
  BlePermissionState,
  GattService,
  BluetoothState,
  NativeBleEvent,
  ScanOptions,
  Unsubscribe,
} from '@beacon/ble-contracts';
import type { BleClient } from '../../src/native/BleClient';

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface PendingCalls {
  bluetoothState: Deferred<BluetoothState>[];
  permissionState: Deferred<BlePermissionState>[];
  permissionRequest: Deferred<BlePermissionState>[];
  startScan: Deferred<void>[];
  stopScan: Deferred<void>[];
  connect: Deferred<void>[];
  disconnect: Deferred<void>[];
  readRssi: Deferred<number>[];
  discoverServices: Deferred<GattService[]>[];
}

/**
 * Deterministic in-memory stand-in for the native bridge, used by component
 * and integration tests. Every native call stays pending until the test
 * resolves or rejects it, so ordering and in-flight states can be asserted.
 * The scripted MockBleClient (src/mock) is the runtime alternative.
 */
export class FakeBleClient implements BleClient {
  private readonly listeners = new Set<(event: NativeBleEvent) => void>();
  private readonly pending: PendingCalls = {
    bluetoothState: [],
    permissionState: [],
    permissionRequest: [],
    startScan: [],
    stopScan: [],
    connect: [],
    disconnect: [],
    readRssi: [],
    discoverServices: [],
  };

  getBluetoothStateCalls = 0;
  getPermissionStateCalls = 0;
  requestPermissionCalls = 0;
  startScanCalls: ScanOptions[] = [];
  stopScanCalls = 0;
  connectCalls: string[] = [];
  disconnectCalls: string[] = [];
  readRssiCalls: string[] = [];
  discoverServicesCalls: string[] = [];

  getBluetoothState(): Promise<BluetoothState> {
    this.getBluetoothStateCalls += 1;
    return this.defer('bluetoothState');
  }

  getPermissionState(): Promise<BlePermissionState> {
    this.getPermissionStateCalls += 1;
    return this.defer('permissionState');
  }

  requestPermission(): Promise<BlePermissionState> {
    this.requestPermissionCalls += 1;
    return this.defer('permissionRequest');
  }

  startScan(options: ScanOptions = {}): Promise<void> {
    this.startScanCalls.push(options);
    return this.defer('startScan');
  }

  stopScan(): Promise<void> {
    this.stopScanCalls += 1;
    return this.defer('stopScan');
  }

  connect(deviceId: string): Promise<void> {
    this.connectCalls.push(deviceId);
    return this.defer('connect');
  }

  disconnect(deviceId: string): Promise<void> {
    this.disconnectCalls.push(deviceId);
    return this.defer('disconnect');
  }

  readRssi(deviceId: string): Promise<number> {
    this.readRssiCalls.push(deviceId);
    return this.defer('readRssi');
  }

  discoverServices(deviceId: string): Promise<GattService[]> {
    this.discoverServicesCalls.push(deviceId);
    return this.defer('discoverServices');
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
    this.take('bluetoothState').forEach(d => d.resolve(state));
  }

  rejectBluetoothState(error: unknown): void {
    this.take('bluetoothState').forEach(d => d.reject(error));
  }

  resolvePermissionState(state: BlePermissionState): void {
    this.take('permissionState').forEach(d => d.resolve(state));
  }

  rejectPermissionState(error: unknown): void {
    this.take('permissionState').forEach(d => d.reject(error));
  }

  resolvePermissionRequest(state: BlePermissionState): void {
    this.take('permissionRequest').forEach(d => d.resolve(state));
  }

  rejectPermissionRequest(error: unknown): void {
    this.take('permissionRequest').forEach(d => d.reject(error));
  }

  resolveStartScan(): void {
    this.take('startScan').forEach(d => d.resolve());
  }

  rejectStartScan(error: unknown): void {
    this.take('startScan').forEach(d => d.reject(error));
  }

  resolveStopScan(): void {
    this.take('stopScan').forEach(d => d.resolve());
  }

  rejectStopScan(error: unknown): void {
    this.take('stopScan').forEach(d => d.reject(error));
  }

  resolveConnect(): void {
    this.take('connect').forEach(d => d.resolve());
  }

  rejectConnect(error: unknown): void {
    this.take('connect').forEach(d => d.reject(error));
  }

  resolveDisconnect(): void {
    this.take('disconnect').forEach(d => d.resolve());
  }

  rejectDisconnect(error: unknown): void {
    this.take('disconnect').forEach(d => d.reject(error));
  }

  resolveRssi(rssi: number): void {
    this.take('readRssi').forEach(d => d.resolve(rssi));
  }

  rejectRssi(error: unknown): void {
    this.take('readRssi').forEach(d => d.reject(error));
  }

  resolveServices(services: GattService[]): void {
    this.take('discoverServices').forEach(d => d.resolve(services));
  }

  rejectServices(error: unknown): void {
    this.take('discoverServices').forEach(d => d.reject(error));
  }

  /** Emits the native transition sequence for a connection that reaches `ready`. */
  emitConnected(deviceId: string): void {
    for (const state of [
      'connecting',
      'connected',
      'discovering_services',
      'ready',
    ] as const) {
      this.emit({ type: 'connection.state_changed', deviceId, state });
    }
  }

  emit(event: NativeBleEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  private defer<K extends keyof PendingCalls>(
    key: K,
  ): Promise<PendingCalls[K][number] extends Deferred<infer T> ? T : never> {
    return new Promise((resolve, reject) => {
      (this.pending[key] as Deferred<unknown>[]).push({
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
  }

  private take<K extends keyof PendingCalls>(key: K): PendingCalls[K] {
    const pending = this.pending[key];
    this.pending[key] = [] as unknown as PendingCalls[K];
    return pending;
  }
}
