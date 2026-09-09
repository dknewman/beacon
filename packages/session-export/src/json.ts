import type { BleSession, SessionEvent } from '@beacon/ble-contracts';
import { parseBleSession, parseSessionEvent } from '@beacon/validation';
import { canonicalEvent, canonicalSession } from './canonical';

/**
 * Full-fidelity JSON export (PROJECT.md 21). Every field the repository holds
 * is written, so `parseJsonExport(toJsonExport(x))` reproduces `x`. Keys are
 * written in a canonical order, which makes the output byte-stable: exporting
 * a document that was just parsed reproduces the same file. The document
 * carries its own version so a future reader can tell which shape it is
 * looking at without guessing from the contents.
 */
export const JSON_EXPORT_VERSION = 1;

export interface SessionExportDocument {
  /** Identifies the shape of this document; bumped when the layout changes. */
  version: number;
  /** Names the tool that wrote the file, for someone reading it years later. */
  generator: string;
  /** When the export was taken, distinct from when the session ran. */
  exportedAt: string;
  session: BleSession;
  events: SessionEvent[];
}

export interface JsonExportOptions {
  /** Defaults to now; supplied by tests and by callers that batch exports. */
  exportedAt?: string;
  /** Indentation for the output; 2 keeps it readable, 0 keeps it small. */
  indent?: number;
}

export const EXPORT_GENERATOR = 'beacon';

export function buildSessionExport(
  session: BleSession,
  events: readonly SessionEvent[],
  options: JsonExportOptions = {},
): SessionExportDocument {
  return {
    version: JSON_EXPORT_VERSION,
    generator: EXPORT_GENERATOR,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    session: canonicalSession(session),
    events: events.map(canonicalEvent),
  };
}

export function toJsonExport(
  session: BleSession,
  events: readonly SessionEvent[],
  options: JsonExportOptions = {},
): string {
  return `${JSON.stringify(buildSessionExport(session, events, options), null, options.indent ?? 2)}\n`;
}

export class ExportParseError extends Error {
  override readonly name = 'ExportParseError';
}

/**
 * Reads a document back. Used by the fidelity tests and by anything that
 * later imports an export; every field goes through the same runtime schemas
 * the repository uses, so a hand-edited file fails here rather than deeper in.
 */
export function parseJsonExport(text: string): SessionExportDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ExportParseError(
      `The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ExportParseError('The document is not an object');
  }
  const document = raw as Partial<SessionExportDocument>;
  if (document.version !== JSON_EXPORT_VERSION) {
    throw new ExportParseError(
      `Unsupported export version ${String(document.version)}; expected ${JSON_EXPORT_VERSION}`,
    );
  }
  if (typeof document.exportedAt !== 'string') {
    throw new ExportParseError('The document has no exportedAt timestamp');
  }
  const session = parseBleSession(document.session);
  if (!session.ok) {
    throw new ExportParseError(`The session is invalid: ${session.error.message}`);
  }
  if (!Array.isArray(document.events)) {
    throw new ExportParseError('The document has no events array');
  }
  const events: SessionEvent[] = document.events.map((candidate, index) => {
    const parsed = parseSessionEvent(candidate);
    if (!parsed.ok) {
      throw new ExportParseError(`Event ${index} is invalid: ${parsed.error.message}`);
    }
    return parsed.value;
  });
  return {
    version: JSON_EXPORT_VERSION,
    generator: typeof document.generator === 'string' ? document.generator : '',
    exportedAt: document.exportedAt,
    session: canonicalSession(session.value),
    events: events.map(canonicalEvent),
  };
}
