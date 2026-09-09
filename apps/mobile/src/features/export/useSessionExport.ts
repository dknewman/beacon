import { useCallback, useReducer, useRef } from 'react';
import {
  EXPORT_MIME_TYPES,
  exportFileName,
  toCsvExport,
  toExportError,
  toJsonExport,
  type ExportFormat,
} from '@beacon/session-export';
import type { BleSession, SessionEvent } from '@beacon/ble-contracts';
import { useExportClient } from '../../native/ExportClientContext';
import type { SessionRepository } from '../sessions/SessionRepository';
import { exportReducer, initialExportState, type ExportPhase } from './exportReducer';

export interface SessionExport {
  state: ExportPhase;
  /** Builds and shares the session in `format`; ignored while one is running. */
  exportSession: (format: ExportFormat) => void;
}

/**
 * Drives one session's export (PROJECT.md 21): read the session and every
 * event from the store, serialize, write a temporary file, then hand it to the
 * platform share sheet.
 *
 * The events are read here rather than taken from the screen so an export is
 * always the whole session, not the page the timeline happens to have loaded.
 */
export function useSessionExport(
  repository: SessionRepository,
  sessionId: string,
): SessionExport {
  const client = useExportClient();
  const [state, dispatch] = useReducer(exportReducer, initialExportState);
  const busy = useRef(false);

  const exportSession = useCallback(
    (format: ExportFormat) => {
      if (busy.current) {
        return;
      }
      busy.current = true;
      dispatch({ type: 'export_requested', format });

      const run = async (): Promise<void> => {
        const { session, events } = await readSession(repository, sessionId);
        const fileName = exportFileName(session, format);
        const contents =
          format === 'json'
            ? toJsonExport(session, events)
            : toCsvExport(session, events);
        const path = await client.writeTemporaryFile(fileName, contents);
        dispatch({ type: 'file_written', format, fileName });
        const shared = await client.shareFile(path, EXPORT_MIME_TYPES[format]);
        dispatch({ type: 'share_settled', shared });
      };

      run()
        .catch((error: unknown) => {
          dispatch({ type: 'export_failed', message: toExportError(error).message });
        })
        .finally(() => {
          busy.current = false;
        });
    },
    [client, repository, sessionId],
  );

  return { state, exportSession };
}

interface LoadedSession {
  session: BleSession;
  events: SessionEvent[];
}

/**
 * Both reads are wrapped together: anything the store refuses is the source
 * failing, whichever call it came from. Splitting them would let a rejection
 * from `getSession` fall through as an unknown failure while the identical
 * one from `listEvents` reported the source.
 */
async function readSession(
  repository: SessionRepository,
  sessionId: string,
): Promise<LoadedSession> {
  try {
    const session = await repository.getSession(sessionId);
    if (session === undefined) {
      throw new Error('The session is no longer stored');
    }
    return { session, events: await repository.listEvents(sessionId) };
  } catch (error: unknown) {
    throw toExportError(error, 'export_source_failed');
  }
}
