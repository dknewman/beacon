import type { BleParser, ParserContext } from '@beacon/ble-contracts';
import { ByteReader, ParseError, sig } from '../reader';

/** Battery Level (0x2A19): one byte, 0..100 percent. */
export const batteryLevelParser: BleParser = {
  id: 'battery-level',
  matches: (context: ParserContext) => context.characteristicUuid === sig('2A19'),
  parse: bytes => {
    const reader = new ByteReader(bytes);
    const level = reader.uint8('battery level');
    reader.expectEnd();
    if (level > 100) {
      throw new ParseError(`Battery level ${level} is above 100 %`);
    }
    return {
      parserId: 'battery-level',
      label: 'Battery level',
      summary: `${level} %`,
      fields: [{ name: 'Battery level', value: level, unit: '%' }],
    };
  },
};
