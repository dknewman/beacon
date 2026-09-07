/* eslint-disable no-bitwise -- profile flag bytes are read with bit masks */
import type { BleParser, ParsedField, ParserContext } from '@beacon/ble-contracts';
import { ByteReader, ParseError, formatDateTime, round, sig } from '../reader';

const FLAG_IMPERIAL = 0x01;
const FLAG_TIMESTAMP = 0x02;
const FLAG_USER_ID = 0x04;
const FLAG_BMI_HEIGHT = 0x08;
const WEIGHT_UNSUCCESSFUL = 0xffff;

/**
 * Weight Measurement (0x2A9D): flags, weight in 5 g or 0.01 lb units, then an
 * optional timestamp, user id, and BMI with height.
 */
export const weightMeasurementParser: BleParser = {
  id: 'weight-measurement',
  matches: (context: ParserContext) => context.characteristicUuid === sig('2A9D'),
  parse: bytes => {
    const reader = new ByteReader(bytes);
    const flags = reader.uint8('flags');
    const imperial = (flags & FLAG_IMPERIAL) !== 0;
    const rawWeight = reader.uint16('weight');
    if (rawWeight === WEIGHT_UNSUCCESSFUL) {
      throw new ParseError('The scale reported an unsuccessful measurement');
    }
    const unit = imperial ? 'lb' : 'kg';
    const weight = imperial ? round(rawWeight * 0.01, 2) : round(rawWeight * 0.005, 3);
    const fields: ParsedField[] = [{ name: 'Weight', value: weight, unit }];
    if (flags & FLAG_TIMESTAMP) {
      const measuredAt = reader.dateTime('timestamp');
      if (measuredAt !== undefined) {
        fields.push({ name: 'Measured at', value: formatDateTime(measuredAt) });
      }
    }
    if (flags & FLAG_USER_ID) {
      const userId = reader.uint8('user id');
      fields.push({ name: 'User', value: userId === 0xff ? 'Unknown' : userId });
    }
    if (flags & FLAG_BMI_HEIGHT) {
      fields.push({ name: 'BMI', value: round(reader.uint16('BMI') * 0.1, 1) });
      const rawHeight = reader.uint16('height');
      fields.push(
        imperial
          ? { name: 'Height', value: round(rawHeight * 0.1, 1), unit: 'in' }
          : { name: 'Height', value: round(rawHeight * 0.001, 3), unit: 'm' },
      );
    }
    reader.expectEnd();
    return {
      parserId: 'weight-measurement',
      label: 'Weight',
      summary: `${weight} ${unit}`,
      fields,
    };
  },
};
