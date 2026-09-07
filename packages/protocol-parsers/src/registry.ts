import type { BleParser, ParsedValue, ParserContext } from '@beacon/ble-contracts';
import { parseParsedValue } from '@beacon/validation';
import { batteryLevelParser } from './parsers/batteryLevel';
import { bloodPressureMeasurementParser } from './parsers/bloodPressureMeasurement';
import { heartRateMeasurementParser } from './parsers/heartRateMeasurement';
import { rawBytesParser } from './parsers/rawBytes';
import { utf8TextParser } from './parsers/utf8Text';
import { weightMeasurementParser } from './parsers/weightMeasurement';

/**
 * A parsed value, or why the matched parser could not produce one together with
 * the raw fallback so the caller always has something to show.
 */
export type ParseOutcome =
  | { ok: true; value: ParsedValue }
  | { ok: false; parserId: string; reason: string; fallback: ParsedValue };

export interface ParserRegistry {
  readonly parsers: readonly BleParser[];
  /** The first parser that matches; the raw fallback when none does. */
  resolve(context: ParserContext): BleParser;
  parse(bytes: readonly number[] | Uint8Array, context: ParserContext): ParseOutcome;
}

/**
 * Parser registry (PROJECT.md 19). Parsers are consulted in order; the raw
 * fallback closes the list so every value parses to something. A parser that
 * throws, or that returns a value the runtime schema rejects, yields a failed
 * outcome carrying the raw fallback rather than propagating.
 */
export function createParserRegistry(parsers: readonly BleParser[]): ParserRegistry {
  const ordered = parsers.includes(rawBytesParser)
    ? parsers
    : [...parsers, rawBytesParser];
  return {
    parsers: ordered,
    resolve: context => ordered.find(parser => parser.matches(context)) ?? rawBytesParser,
    parse: (bytes, context) => {
      const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
      const parser =
        ordered.find(candidate => candidate.matches(context)) ?? rawBytesParser;
      const fallback = () => rawBytesParser.parse(input, context);
      let produced: unknown;
      try {
        produced = parser.parse(input, context);
      } catch (error) {
        return {
          ok: false,
          parserId: parser.id,
          reason: error instanceof Error ? error.message : String(error),
          fallback: fallback(),
        };
      }
      const validated = parseParsedValue(produced);
      if (!validated.ok) {
        return {
          ok: false,
          parserId: parser.id,
          reason: validated.error.message,
          fallback: fallback(),
        };
      }
      return { ok: true, value: validated.value };
    },
  };
}

/** The parsers PROJECT.md 19 asks for, most specific first, raw fallback last. */
export const standardParsers: readonly BleParser[] = [
  batteryLevelParser,
  heartRateMeasurementParser,
  weightMeasurementParser,
  bloodPressureMeasurementParser,
  utf8TextParser,
  rawBytesParser,
];

export const defaultParserRegistry: ParserRegistry =
  createParserRegistry(standardParsers);
