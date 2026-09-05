import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

export interface StatusRowProps {
  label: string;
  value: string;
  detail?: string;
  testID?: string;
}

/**
 * Label/value row for status information. The whole row is one accessible
 * element so screen readers announce "Bluetooth, On, ..." as a unit, and the
 * value is a text label rather than a colored dot.
 */
export function StatusRow({
  label,
  value,
  detail,
  testID,
}: StatusRowProps): React.JSX.Element {
  const theme = useTheme();
  const accessibilityLabel =
    detail === undefined ? `${label}, ${value}` : `${label}, ${value}. ${detail}`;

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[styles.row, { backgroundColor: theme.colors.surface }]}
      testID={testID}
    >
      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{label}</Text>
      <Text
        style={[styles.value, { color: theme.colors.textPrimary }]}
        testID={testID === undefined ? undefined : `${testID}-value`}
      >
        {value}
      </Text>
      {detail === undefined ? null : (
        <Text style={[styles.detail, { color: theme.colors.textSecondary }]}>
          {detail}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 22,
    fontWeight: '600',
  },
  detail: {
    fontSize: 15,
  },
});
