/* eslint-disable no-bitwise -- profile flag bytes are read with bit masks */
import type { BleParser, ParsedField, ParserContext } from '@beacon/ble-contracts';
import { ByteReader, formatDateTime, sfloatDisplay, sig } from '../reader';

const FLAG_KPA = 0x01;
const FLAG_TIMESTAMP = 0x02;
const FLAG_PULSE_RATE = 0x04;
const FLAG_USER_ID = 0x08;
const FLAG_STATUS = 0x10;

const STATUS_BODY_MOVEMENT = 0x0001;
const STATUS_CUFF_LOOSE = 0x0002;
const STATUS_IRREGULAR_PULSE = 0x0004;
const STATUS_PULSE_RANGE = 0x0018;
const STATUS_IMPROPER_POSITION = 0x0020;

/**
 * Blood Pressure Measurement (0x2A35): flags, systolic, diastolic and mean
 * arterial pressure as SFLOATs in mmHg or kPa, then an optional timestamp,
 * pulse rate, user id and measurement status.
 */
export const bloodPressureMeasurementParser: BleParser = {
  id: 'blood-pressure-measurement',
  matches: (context: ParserContext) => context.characteristicUuid === sig('2A35'),
  parse: bytes => {
    const reader = new ByteReader(bytes);
    const flags = reader.uint8('flags');
    const unit = flags & FLAG_KPA ? 'kPa' : 'mmHg';
    const systolic = sfloatDisplay(reader.sfloat('systolic'));
    const diastolic = sfloatDisplay(reader.sfloat('diastolic'));
    const mean = sfloatDisplay(reader.sfloat('mean arterial pressure'));
    const fields: ParsedField[] = [
      { name: 'Systolic', value: systolic, unit },
      { name: 'Diastolic', value: diastolic, unit },
      { name: 'Mean arterial pressure', value: mean, unit },
    ];
    if (flags & FLAG_TIMESTAMP) {
      const measuredAt = reader.dateTime('timestamp');
      if (measuredAt !== undefined) {
        fields.push({ name: 'Measured at', value: formatDateTime(measuredAt) });
      }
    }
    if (flags & FLAG_PULSE_RATE) {
      fields.push({
        name: 'Pulse rate',
        value: sfloatDisplay(reader.sfloat('pulse rate')),
        unit: 'bpm',
      });
    }
    if (flags & FLAG_USER_ID) {
      const userId = reader.uint8('user id');
      fields.push({ name: 'User', value: userId === 0xff ? 'Unknown' : userId });
    }
    if (flags & FLAG_STATUS) {
      const status = reader.uint16('measurement status');
      const problems: string[] = [];
      if (status & STATUS_BODY_MOVEMENT) problems.push('body movement');
      if (status & STATUS_CUFF_LOOSE) problems.push('cuff too loose');
      if (status & STATUS_IRREGULAR_PULSE) problems.push('irregular pulse');
      if (status & STATUS_PULSE_RANGE) problems.push('pulse rate out of range');
      if (status & STATUS_IMPROPER_POSITION) problems.push('improper position');
      fields.push({
        name: 'Status',
        value: problems.length === 0 ? 'OK' : problems.join(', '),
      });
    }
    reader.expectEnd();
    return {
      parserId: 'blood-pressure-measurement',
      label: 'Blood pressure',
      summary: `${systolic}/${diastolic} ${unit}`,
      fields,
    };
  },
};
