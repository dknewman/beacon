/* eslint-disable no-bitwise -- profile flag bytes are read with bit masks */
import type { BleParser, ParsedField, ParserContext } from '@beacon/ble-contracts';
import { ByteReader, round, sig } from '../reader';

const FLAG_FORMAT_UINT16 = 0x01;
const FLAG_CONTACT_DETECTED = 0x02;
const FLAG_CONTACT_SUPPORTED = 0x04;
const FLAG_ENERGY_EXPENDED = 0x08;
const FLAG_RR_INTERVAL = 0x10;

/**
 * Heart Rate Measurement (0x2A37): flags, an 8- or 16-bit rate, optional
 * energy expended (kJ) and as many RR intervals (1/1024 s) as the packet holds.
 */
export const heartRateMeasurementParser: BleParser = {
  id: 'heart-rate-measurement',
  matches: (context: ParserContext) => context.characteristicUuid === sig('2A37'),
  parse: bytes => {
    const reader = new ByteReader(bytes);
    const flags = reader.uint8('flags');
    const rate =
      flags & FLAG_FORMAT_UINT16
        ? reader.uint16('heart rate')
        : reader.uint8('heart rate');
    const fields: ParsedField[] = [{ name: 'Heart rate', value: rate, unit: 'bpm' }];
    if (flags & FLAG_CONTACT_SUPPORTED) {
      fields.push({
        name: 'Sensor contact',
        value: flags & FLAG_CONTACT_DETECTED ? 'Detected' : 'Not detected',
      });
    }
    if (flags & FLAG_ENERGY_EXPENDED) {
      fields.push({
        name: 'Energy expended',
        value: reader.uint16('energy expended'),
        unit: 'kJ',
      });
    }
    if (flags & FLAG_RR_INTERVAL) {
      const intervals: number[] = [];
      while (reader.remaining >= 2) {
        intervals.push(round((reader.uint16('RR interval') / 1024) * 1000, 1));
      }
      fields.push({ name: 'RR intervals', value: intervals.join(', '), unit: 'ms' });
    }
    reader.expectEnd();
    return {
      parserId: 'heart-rate-measurement',
      label: 'Heart rate',
      summary: `${rate} bpm`,
      fields,
    };
  },
};
