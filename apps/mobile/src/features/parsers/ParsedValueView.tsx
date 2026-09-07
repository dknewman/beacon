import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ParseOutcome } from '@beacon/protocol-parsers';
import { useTheme } from '../../theme/useTheme';
import { formatField, presentableValue } from './parsePacket';

export interface ParsedValueViewProps {
  outcome: ParseOutcome;
  testID: string;
}

/**
 * The parsed reading of a value (PROJECT.md 18, 19): the parser's label and
 * one-line summary, then every field. When the matched parser could not parse
 * the bytes the reason is shown and the raw fallback stands in, so a broken
 * or non-conformant peripheral is visible rather than silently hidden.
 */
export function ParsedValueView({
  outcome,
  testID,
}: ParsedValueViewProps): React.JSX.Element | null {
  const theme = useTheme();
  const presented = presentableValue(outcome);
  if (presented === undefined) {
    return null;
  }
  const { value, failure } = presented;
  return (
    <View
      accessible
      accessibilityLabel={`${value.label}, ${value.summary}`}
      style={styles.container}
      testID={testID}
    >
      <Text
        style={[styles.label, { color: theme.colors.textSecondary }]}
        testID={`${testID}-label`}
      >
        {value.label}
      </Text>
      <Text
        style={[styles.summary, { color: theme.colors.textPrimary }]}
        testID={`${testID}-summary`}
      >
        {value.summary}
      </Text>
      {failure === undefined ? null : (
        <Text
          style={[styles.failure, { color: theme.colors.textSecondary }]}
          testID={`${testID}-error`}
        >
          {`${failure.parserId} could not parse this value: ${failure.reason}`}
        </Text>
      )}
      {value.fields.map((field, index) => (
        <View key={`${field.name}-${index}`} style={styles.field}>
          <Text style={[styles.fieldName, { color: theme.colors.textSecondary }]}>
            {field.name}
          </Text>
          <Text
            selectable
            style={[styles.fieldValue, { color: theme.colors.textPrimary }]}
            testID={`${testID}-field-${index}`}
          >
            {formatField(field)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
    paddingBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  summary: {
    fontSize: 22,
    fontWeight: '600',
  },
  failure: {
    fontSize: 13,
  },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  fieldName: {
    fontSize: 14,
  },
  fieldValue: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
});
