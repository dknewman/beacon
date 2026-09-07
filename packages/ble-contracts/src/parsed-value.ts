/**
 * Output of a protocol parser (PROJECT.md 19). Parsers live outside the UI
 * and produce this display-ready shape; the registry validates it at runtime
 * so a mis-written parser cannot push malformed data into the packet
 * inspector or a recorded session.
 */
export interface ParsedField {
  /** Human name, e.g. "Heart rate". */
  name: string;
  value: number | string | boolean;
  /** Display unit, e.g. "bpm", "%", "kg"; omitted for unitless fields. */
  unit?: string;
}

export interface ParsedValue {
  /** Which parser produced this, e.g. "battery-level". */
  parserId: string;
  /** What the value is, e.g. "Battery level". */
  label: string;
  /** One line for lists and the packet log, e.g. "92 %". */
  summary: string;
  fields: ParsedField[];
}

/** What a parser knows about the characteristic a value came from. */
export interface ParserContext {
  /** Canonical 128-bit uppercase UUIDs. */
  serviceUuid: string;
  characteristicUuid: string;
  deviceName?: string;
}

export interface BleParser<T extends ParsedValue = ParsedValue> {
  id: string;
  matches(context: ParserContext): boolean;
  /** Throws on malformed input; the registry turns that into a failed outcome. */
  parse(bytes: Uint8Array, context: ParserContext): T;
}
