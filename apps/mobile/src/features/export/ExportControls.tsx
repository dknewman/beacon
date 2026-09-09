import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ExportFormat } from '@beacon/session-export';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useTheme } from '../../theme/useTheme';
import {
  describeExportButton,
  describeExportStatus,
  EXPORT_PRIVACY_NOTE,
} from './exportPresentation';
import type { ExportPhase } from './exportReducer';

export interface ExportControlsProps {
  state: ExportPhase;
  onExport: (format: ExportFormat) => void;
  /** Exporting a session that is still recording would capture only part of it. */
  disabledReason?: string;
}

const FORMATS: readonly ExportFormat[] = ['json', 'csv'];

/** The Export JSON and Export CSV buttons, their progress line and the privacy note. */
export function ExportControls({
  state,
  onExport,
  disabledReason,
}: ExportControlsProps): React.JSX.Element {
  const theme = useTheme();
  const status = disabledReason ?? describeExportStatus(state);

  return (
    <View style={styles.container} testID="export-controls">
      {FORMATS.map(format => {
        const button = describeExportButton(state, format);
        return (
          <PrimaryButton
            key={format}
            label={button.label}
            onPress={() => onExport(format)}
            disabled={!button.enabled || disabledReason !== undefined}
            testID={`export-${format}`}
          />
        );
      })}
      {status === undefined ? null : (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.status, { color: theme.colors.textSecondary }]}
          testID="export-status"
        >
          {status}
        </Text>
      )}
      <Text
        style={[styles.note, { color: theme.colors.textSecondary }]}
        testID="export-privacy-note"
      >
        {EXPORT_PRIVACY_NOTE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  status: { fontSize: 15 },
  note: { fontSize: 13 },
});
