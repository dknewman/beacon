import { bytesToAscii, bytesToHex, type BleParser } from '@beacon/ble-contracts';

/** The fallback: always matches, never fails, shows the bytes as they are. */
export const rawBytesParser: BleParser = {
  id: 'raw-bytes',
  matches: () => true,
  parse: bytes => {
    const values = Array.from(bytes);
    return {
      parserId: 'raw-bytes',
      label: 'Raw bytes',
      summary: values.length === 0 ? '(empty)' : bytesToHex(values),
      fields: [
        { name: 'Length', value: values.length, unit: 'bytes' },
        { name: 'HEX', value: bytesToHex(values) },
        { name: 'ASCII', value: bytesToAscii(values) },
      ],
    };
  },
};
