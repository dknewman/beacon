import type { BleParser } from '@beacon/ble-contracts';
import { sig } from '../reader';
import {
  createParserRegistry,
  defaultParserRegistry,
  standardParsers,
} from '../registry';

const battery = { serviceUuid: sig('180F'), characteristicUuid: sig('2A19') };
const unknown = { serviceUuid: sig('FFF0'), characteristicUuid: sig('FFF1') };

describe('parser registry', () => {
  it('resolves the most specific parser and falls back to raw bytes', () => {
    expect(defaultParserRegistry.resolve(battery).id).toBe('battery-level');
    expect(defaultParserRegistry.resolve(unknown).id).toBe('raw-bytes');
    expect(defaultParserRegistry.parsers).toEqual(standardParsers);
    expect(standardParsers.at(-1)?.id).toBe('raw-bytes');
  });

  it('parses number arrays as the bridge delivers them', () => {
    expect(defaultParserRegistry.parse([0x5c], battery)).toEqual({
      ok: true,
      value: {
        parserId: 'battery-level',
        label: 'Battery level',
        summary: '92 %',
        fields: [{ name: 'Battery level', value: 92, unit: '%' }],
      },
    });
    expect(defaultParserRegistry.parse(Uint8Array.from([0x01]), unknown)).toMatchObject({
      ok: true,
      value: { parserId: 'raw-bytes', summary: '01' },
    });
  });

  it('turns a parser failure into an outcome carrying the raw fallback', () => {
    const outcome = defaultParserRegistry.parse([101], battery);
    expect(outcome).toEqual({
      ok: false,
      parserId: 'battery-level',
      reason: 'Battery level 101 is above 100 %',
      fallback: {
        parserId: 'raw-bytes',
        label: 'Raw bytes',
        summary: '65',
        fields: [
          { name: 'Length', value: 1, unit: 'bytes' },
          { name: 'HEX', value: '65' },
          { name: 'ASCII', value: 'e' },
        ],
      },
    });
  });

  it('validates what a parser returns before handing it on', () => {
    const broken: BleParser = {
      id: 'broken',
      matches: () => true,
      parse: () => ({ parserId: 'broken', label: '', summary: 'x', fields: [] }),
    };
    const registry = createParserRegistry([broken]);
    expect(registry.parsers.map(parser => parser.id)).toEqual(['broken', 'raw-bytes']);
    const outcome = registry.parse([1], unknown);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.parserId).toBe('broken');
      expect(outcome.reason).toMatch(/Invalid parser output/);
      expect(outcome.fallback.parserId).toBe('raw-bytes');
    }
  });

  it('keeps registration order so a custom parser can take precedence', () => {
    const custom: BleParser = {
      id: 'custom-battery',
      matches: context => context.characteristicUuid === sig('2A19'),
      parse: () => ({
        parserId: 'custom-battery',
        label: 'Custom',
        summary: 'custom',
        fields: [],
      }),
    };
    const registry = createParserRegistry([custom, ...standardParsers]);
    expect(registry.resolve(battery).id).toBe('custom-battery');
  });
});
