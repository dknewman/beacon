import type { BlePacket, ParsedValue } from '@beacon/ble-contracts';
import {
  defaultParserRegistry,
  type ParseOutcome,
  type ParserRegistry,
} from '@beacon/protocol-parsers';

/** Runs the registry over a logged packet; the packet's UUIDs are the parser context. */
export function parsePacket(
  packet: BlePacket,
  registry: ParserRegistry = defaultParserRegistry,
): ParseOutcome {
  return registry.parse(packet.bytes, {
    serviceUuid: packet.serviceUuid,
    characteristicUuid: packet.characteristicUuid,
  });
}

/**
 * The parsed value worth showing next to the raw columns: a real parser's
 * result, or nothing when only the raw fallback matched (the HEX column
 * already shows that). A failed parse is returned as well so the screen can
 * say which parser gave up and why.
 */
export function presentableValue(
  outcome: ParseOutcome,
): { value: ParsedValue; failure?: { parserId: string; reason: string } } | undefined {
  if (outcome.ok) {
    return outcome.value.parserId === 'raw-bytes' ? undefined : { value: outcome.value };
  }
  return {
    value: outcome.fallback,
    failure: { parserId: outcome.parserId, reason: outcome.reason },
  };
}

/** One-line summary for a packet row, or undefined when there is nothing beyond the hex. */
export function packetSummary(
  packet: BlePacket,
  registry?: ParserRegistry,
): string | undefined {
  const outcome = parsePacket(packet, registry);
  if (!outcome.ok || outcome.value.parserId === 'raw-bytes') {
    return undefined;
  }
  return outcome.value.summary;
}

export function formatField(field: ParsedValue['fields'][number]): string {
  const value =
    typeof field.value === 'boolean' ? (field.value ? 'Yes' : 'No') : field.value;
  return field.unit === undefined ? String(value) : `${value} ${field.unit}`;
}
