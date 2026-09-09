import type { ExportFormat } from '@beacon/session-export';

/**
 * State of the export controls for one session (PROJECT.md 21, 29).
 *
 * Export is an explicit, user-initiated action (PROJECT.md 35: "Export only
 * after explicit user action"), so there is no automatic path into this
 * machine. One export runs at a time: the buttons are disabled while a
 * document is being built or a sheet is open, because two share sheets cannot
 * be presented at once and a second export would only race the first.
 */
export type ExportPhase =
  /** Nothing in flight; `lastOutcome` says how the previous attempt ended. */
  | { phase: 'idle'; lastOutcome?: ExportOutcome }
  /** Reading the session and its events, then serializing and writing the file. */
  | { phase: 'preparing'; format: ExportFormat }
  /** The platform share sheet is open. */
  | { phase: 'sharing'; format: ExportFormat; fileName: string };

export type ExportOutcome =
  | { kind: 'shared'; format: ExportFormat; fileName: string }
  /** The person closed the sheet without sharing; only iOS can report this. */
  | { kind: 'dismissed'; format: ExportFormat; fileName: string }
  | { kind: 'failed'; format: ExportFormat; message: string };

export type ExportAction =
  | { type: 'export_requested'; format: ExportFormat }
  | { type: 'file_written'; format: ExportFormat; fileName: string }
  | { type: 'share_settled'; shared: boolean }
  | { type: 'export_failed'; message: string };

export const initialExportState: ExportPhase = { phase: 'idle' };

export function exportReducer(state: ExportPhase, action: ExportAction): ExportPhase {
  switch (action.type) {
    case 'export_requested':
      // One at a time: a request while busy is ignored rather than queued,
      // because the person can simply press again once the sheet closes.
      return state.phase === 'idle'
        ? { phase: 'preparing', format: action.format }
        : state;
    case 'file_written':
      return state.phase === 'preparing'
        ? { phase: 'sharing', format: state.format, fileName: action.fileName }
        : state;
    case 'share_settled':
      return state.phase === 'sharing'
        ? {
            phase: 'idle',
            lastOutcome: {
              kind: action.shared ? 'shared' : 'dismissed',
              format: state.format,
              fileName: state.fileName,
            },
          }
        : state;
    case 'export_failed':
      return state.phase === 'idle'
        ? state
        : {
            phase: 'idle',
            lastOutcome: {
              kind: 'failed',
              format: state.format,
              message: action.message,
            },
          };
  }
}

export function isExporting(state: ExportPhase): boolean {
  return state.phase !== 'idle';
}
