import type { BlePacket } from '@beacon/ble-contracts';
import {
  createPacket,
  initialPacketLogState,
  packetLogReducer,
  packetsForCharacteristic,
  packetsOf,
} from '../packetLogReducer';

const SERVICE = '0000180F-0000-1000-8000-00805F9B34FB';
const LEVEL = '00002A19-0000-1000-8000-00805F9B34FB';
const NAME = '00002A00-0000-1000-8000-00805F9B34FB';

function packet(
  deviceId: string,
  characteristicUuid: string,
  bytes: number[],
): BlePacket {
  return createPacket({
    deviceId,
    serviceUuid: SERVICE,
    characteristicUuid,
    direction: 'incoming',
    bytes,
  });
}

describe('packetLogReducer', () => {
  it('keeps packets newest first per device', () => {
    let state = packetLogReducer(initialPacketLogState, {
      type: 'packet_recorded',
      packet: packet('a', LEVEL, [1]),
    });
    state = packetLogReducer(state, {
      type: 'packet_recorded',
      packet: packet('a', LEVEL, [2]),
    });
    state = packetLogReducer(state, {
      type: 'packet_recorded',
      packet: packet('b', LEVEL, [3]),
    });
    expect(packetsOf(state, 'a').map(item => item.bytes)).toEqual([[2], [1]]);
    expect(packetsOf(state, 'b').map(item => item.bytes)).toEqual([[3]]);
    expect(packetsOf(state, 'c')).toEqual([]);
  });

  it('caps the log at the capacity, dropping the oldest', () => {
    let state = initialPacketLogState;
    for (let index = 0; index < 5; index += 1) {
      state = packetLogReducer(
        state,
        { type: 'packet_recorded', packet: packet('a', LEVEL, [index]) },
        3,
      );
    }
    expect(packetsOf(state, 'a').map(item => item.bytes)).toEqual([[4], [3], [2]]);
  });

  it('filters by characteristic and clears per device', () => {
    let state = packetLogReducer(initialPacketLogState, {
      type: 'packet_recorded',
      packet: packet('a', LEVEL, [1]),
    });
    state = packetLogReducer(state, {
      type: 'packet_recorded',
      packet: packet('a', NAME, [2]),
    });
    expect(
      packetsForCharacteristic(state, 'a', SERVICE, LEVEL).map(item => item.bytes),
    ).toEqual([[1]]);
    const cleared = packetLogReducer(state, { type: 'log_cleared', deviceId: 'a' });
    expect(packetsOf(cleared, 'a')).toEqual([]);
    expect(packetLogReducer(cleared, { type: 'log_cleared', deviceId: 'a' })).toBe(
      cleared,
    );
  });

  it('creates packets with unique ids and ISO timestamps', () => {
    const first = packet('a', LEVEL, [1]);
    const second = packet('a', LEVEL, [1]);
    expect(first.id).not.toBe(second.id);
    expect(Number.isNaN(Date.parse(first.timestamp))).toBe(false);
    expect(first.direction).toBe('incoming');
  });
});
