import type { ExportFormat } from '@beacon/session-export';
import type { ExportPhase } from './exportReducer';

const FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
  json: 'JSON',
  csv: 'CSV',
};

export function formatLabel(format: ExportFormat): string {
  return FORMAT_LABELS[format];
}

export interface ExportButtonLabel {
  label: string;
  enabled: boolean;
}

export function describeExportButton(
  state: ExportPhase,
  format: ExportFormat,
): ExportButtonLabel {
  if (state.phase === 'preparing' && state.format === format) {
    return { label: `Preparing ${formatLabel(format)}…`, enabled: false };
  }
  if (state.phase === 'sharing' && state.format === format) {
    return { label: `Sharing ${formatLabel(format)}…`, enabled: false };
  }
  return { label: `Export ${formatLabel(format)}`, enabled: state.phase === 'idle' };
}

/**
 * The line under the buttons. A completed share is reported as the file
 * having been handed to the share sheet rather than as having been delivered,
 * because that is all either platform can actually tell us (see the export
 * spec): the receiving app's outcome is never reported back.
 */
export function describeExportStatus(state: ExportPhase): string | undefined {
  switch (state.phase) {
    case 'preparing':
      return `Building the ${formatLabel(state.format)} document…`;
    case 'sharing':
      return `${state.fileName} is open in the share sheet.`;
    case 'idle':
      break;
  }
  const outcome = state.lastOutcome;
  if (outcome === undefined) {
    return undefined;
  }
  switch (outcome.kind) {
    case 'shared':
      return `${outcome.fileName} was handed to the share sheet.`;
    case 'dismissed':
      return `The share sheet for ${outcome.fileName} was closed without sharing.`;
    case 'failed':
      return `The ${formatLabel(outcome.format)} export failed: ${outcome.message}`;
  }
}

/**
 * Shown next to the controls. Exports carry the device identifier, which on
 * Android is the hardware address, so the person is told before they send the
 * file anywhere (docs/SECURITY.md).
 */
export const EXPORT_PRIVACY_NOTE =
  'Exports include the device identifier and every recorded value.';
