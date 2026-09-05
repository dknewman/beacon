import { parseBluetoothState, parseNativeBleEvent } from '../parse';

describe('parseBluetoothState', () => {
  it('accepts contract values', () => {
    const result = parseBluetoothState('powered_on');
    expect(result).toEqual({ ok: true, value: 'powered_on' });
  });

  it('rejects raw platform values with an invalid_payload BleError', () => {
    const result = parseBluetoothState('CBManagerStatePoweredOn');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_payload');
      expect(result.error.message).toContain('Invalid Bluetooth state from native');
    }
  });
});

describe('parseNativeBleEvent', () => {
  it('validates bluetooth.state_changed', () => {
    expect(
      parseNativeBleEvent({ type: 'bluetooth.state_changed', state: 'powered_off' }),
    ).toEqual({
      ok: true,
      value: { type: 'bluetooth.state_changed', state: 'powered_off' },
    });
  });

  it('normalizes UUIDs inside scan.device_discovered', () => {
    const result = parseNativeBleEvent({
      type: 'scan.device_discovered',
      device: {
        id: 'AA:BB:CC:DD:EE:FF',
        name: 'QN Scale',
        rssi: -48,
        serviceUuids: ['181d', '0000180F-0000-1000-8000-00805F9B34FB'],
        lastSeenAt: '2026-09-05T10:31:02.102Z',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'scan.device_discovered') {
      expect(result.value.device.serviceUuids).toEqual([
        '0000181D-0000-1000-8000-00805F9B34FB',
        '0000180F-0000-1000-8000-00805F9B34FB',
      ]);
    }
  });

  it('validates characteristic.value_changed byte ranges', () => {
    const base = {
      type: 'characteristic.value_changed',
      deviceId: 'dev-1',
      serviceUuid: '180D',
      characteristicUuid: '2A37',
      timestamp: '2026-09-05T10:31:08.522Z',
    };
    expect(parseNativeBleEvent({ ...base, bytes: [0x02, 0x9a, 0x1c, 0, 0] }).ok).toBe(
      true,
    );
    expect(parseNativeBleEvent({ ...base, bytes: [256] }).ok).toBe(false);
    expect(parseNativeBleEvent({ ...base, bytes: [-1] }).ok).toBe(false);
    expect(parseNativeBleEvent({ ...base, bytes: [1.5] }).ok).toBe(false);
  });

  it('validates connection.state_changed against the state machine vocabulary', () => {
    expect(
      parseNativeBleEvent({
        type: 'connection.state_changed',
        deviceId: 'd',
        state: 'ready',
      }).ok,
    ).toBe(true);
    expect(
      parseNativeBleEvent({
        type: 'connection.state_changed',
        deviceId: 'd',
        state: 'STATE_CONNECTED',
      }).ok,
    ).toBe(false);
  });

  it('validates ble.error and keeps native diagnostics', () => {
    const result = parseNativeBleEvent({
      type: 'ble.error',
      deviceId: 'd',
      error: { code: 'connection_failed', message: 'GATT 133', nativeCode: '133' },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        type: 'ble.error',
        deviceId: 'd',
        error: { code: 'connection_failed', message: 'GATT 133', nativeCode: '133' },
      },
    });
  });

  it('rejects unknown event types and reports the failing path', () => {
    const result = parseNativeBleEvent({ type: 'scan.finished' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_payload');
      expect(result.error.message).toContain('type');
    }
  });

  it('rejects non-object input', () => {
    expect(parseNativeBleEvent(null).ok).toBe(false);
    expect(parseNativeBleEvent('bluetooth.state_changed').ok).toBe(false);
  });
});
