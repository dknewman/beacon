import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  bytesToAscii,
  bytesToBinary,
  bytesToDecimal,
  bytesToHex,
  bytesToUtf8,
} from '@beacon/ble-contracts';
import { useTheme } from '../../theme/useTheme';

export interface ValueColumnsProps {
  bytes: number[];
  testID: string;
}

/** The same bytes in every common reading (PROJECT.md 16): HEX, decimal, binary, ASCII, UTF-8. */
export function ValueColumns({ bytes, testID }: ValueColumnsProps): React.JSX.Element {
  const theme = useTheme();
  const utf8 = bytesToUtf8(bytes);
  const rows: Array<[key: string, label: string, value: string]> = [
    ['hex', 'HEX', bytes.length === 0 ? '(empty)' : bytesToHex(bytes)],
    ['decimal', 'DECIMAL', bytesToDecimal(bytes)],
    ['binary', 'BINARY', bytesToBinary(bytes)],
    ['ascii', 'ASCII', bytesToAscii(bytes)],
    ['utf8', 'UTF-8', utf8 === undefined ? 'Not valid UTF-8' : utf8],
  ];
  return (
    <View style={styles.columns} testID={testID}>
      {rows.map(([key, label, value]) => (
        <View
          accessible
          accessibilityLabel={`${label}, ${value === '' ? 'empty' : value}`}
          key={key}
          style={styles.row}
        >
          <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
            {label}
          </Text>
          <Text
            selectable
            style={[
              styles.value,
              key === 'utf8' ? null : styles.monospace,
              { color: theme.colors.textPrimary },
            ]}
            testID={`${testID}-${key}`}
          >
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  columns: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  label: {
    width: 64,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    paddingTop: 2,
  },
  value: {
    flex: 1,
    fontSize: 15,
  },
  monospace: {
    fontFamily: 'monospace',
  },
});
