import { createPacket } from '../packetLogReducer';
import { formatPacketTime, labelPacket } from '../packetPresentation';

describe('packetPresentation', () => {
  it('formats local clock time with milliseconds', () => {
    const local = new Date(2026, 8, 7, 14, 3, 27, 512).toISOString();
    expect(formatPacketTime(local)).toBe('14:03:27.512');
    expect(formatPacketTime(new Date(2026, 0, 1, 0, 0, 0, 5).toISOString())).toBe(
      '00:00:00.005',
    );
    expect(formatPacketTime('not a date')).toBe('not a date');
  });

  it('labels a packet row for sighted and screen reader users', () => {
    const packet = createPacket({
      deviceId: 'a',
      serviceUuid: 's',
      characteristicUuid: 'c',
      direction: 'outgoing',
      bytes: [0x02, 0x9a],
      timestamp: new Date(2026, 8, 7, 9, 5, 1, 7).toISOString(),
    });
    expect(labelPacket(packet)).toEqual({
      direction: 'Outgoing',
      time: '09:05:01.007',
      hex: '02 9A',
      byteCount: '2 bytes',
      accessibilityLabel: 'Outgoing at 09:05:01.007, 2 bytes: 02 9A',
    });
    expect(labelPacket({ ...packet, bytes: [], direction: 'incoming' })).toMatchObject({
      direction: 'Incoming',
      hex: '(empty)',
      byteCount: '0 bytes',
    });
    expect(labelPacket({ ...packet, bytes: [1] }).byteCount).toBe('1 byte');
  });
});
