import { bytesToUtf8, type BleParser, type ParserContext } from '@beacon/ble-contracts';
import { ParseError, sig } from '../reader';

/** SIG string characteristics plus the Nordic UART lines, all plain UTF-8. */
const TEXT_CHARACTERISTICS: ReadonlyMap<string, string> = new Map([
  [sig('2A00'), 'Device name'],
  [sig('2A24'), 'Model number'],
  [sig('2A25'), 'Serial number'],
  [sig('2A26'), 'Firmware revision'],
  [sig('2A27'), 'Hardware revision'],
  [sig('2A28'), 'Software revision'],
  [sig('2A29'), 'Manufacturer name'],
  ['6E400002-B5A3-F393-E0A9-E50E24DCCA9E', 'UART RX'],
  ['6E400003-B5A3-F393-E0A9-E50E24DCCA9E', 'UART TX'],
]);

/** Generic UTF-8 text for the characteristics known to carry strings. */
export const utf8TextParser: BleParser = {
  id: 'utf8-text',
  matches: (context: ParserContext) =>
    TEXT_CHARACTERISTICS.has(context.characteristicUuid),
  parse: (bytes, context) => {
    const text = bytesToUtf8(Array.from(bytes));
    if (text === undefined) {
      throw new ParseError('Not valid UTF-8');
    }
    const label = TEXT_CHARACTERISTICS.get(context.characteristicUuid) ?? 'Text';
    const display = text.replace(/\r?\n$/, '');
    return {
      parserId: 'utf8-text',
      label,
      summary: display === '' ? '(empty)' : display,
      fields: [{ name: label, value: text }],
    };
  },
};
