import { createPacket } from '../../packets/packetLogReducer';
import {
  formatField,
  packetSummary,
  parsePacket,
  presentableValue,
} from '../parsePacket';

const packet = (characteristic: string, bytes: number[]) =>
  createPacket({
    deviceId: 'a',
    serviceUuid: '0000180F-0000-1000-8000-00805F9B34FB',
    characteristicUuid: `0000${characteristic}-0000-1000-8000-00805F9B34FB`,
    direction: 'incoming',
    bytes,
  });

describe('parsePacket', () => {
  it('uses the packet UUIDs as the parser context', () => {
    expect(parsePacket(packet('2A19', [0x5c]))).toMatchObject({
      ok: true,
      value: { parserId: 'battery-level', summary: '92 %' },
    });
    expect(packetSummary(packet('2A19', [0x5c]))).toBe('92 %');
  });

  it('hides the raw fallback because the hex column already shows it', () => {
    const raw = parsePacket(packet('FFF1', [1, 2]));
    expect(presentableValue(raw)).toBeUndefined();
    expect(packetSummary(packet('FFF1', [1, 2]))).toBeUndefined();
  });

  it('keeps a failed parse visible with its reason and the raw stand-in', () => {
    const failed = parsePacket(packet('2A19', [101]));
    expect(presentableValue(failed)).toEqual({
      value: expect.objectContaining({ parserId: 'raw-bytes', summary: '65' }),
      failure: { parserId: 'battery-level', reason: 'Battery level 101 is above 100 %' },
    });
    expect(packetSummary(packet('2A19', [101]))).toBeUndefined();
  });

  it('formats fields with their unit and booleans as words', () => {
    expect(formatField({ name: 'Weight', value: 72.5, unit: 'kg' })).toBe('72.5 kg');
    expect(formatField({ name: 'User', value: 'Unknown' })).toBe('Unknown');
    expect(formatField({ name: 'Contact', value: true })).toBe('Yes');
    expect(formatField({ name: 'Contact', value: false })).toBe('No');
  });
});
