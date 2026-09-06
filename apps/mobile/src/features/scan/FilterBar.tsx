import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { RSSI_THRESHOLDS, type DeviceFilters } from './deviceFilters';

export interface FilterBarProps {
  filters: DeviceFilters;
  onChange: (filters: DeviceFilters) => void;
}

/** Name, service UUID and RSSI threshold filters. Applied in memory; never restarts the scan. */
export function FilterBar({ filters, onChange }: FilterBarProps): React.JSX.Element {
  const theme = useTheme();
  const inputStyle = [
    styles.input,
    { backgroundColor: theme.colors.surface, color: theme.colors.textPrimary },
  ];

  return (
    <View style={styles.bar}>
      <TextInput
        accessibilityLabel="Filter by name"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onChangeText={name => onChange({ ...filters, name })}
        placeholder="Filter by name"
        placeholderTextColor={theme.colors.textSecondary}
        style={inputStyle}
        testID="filter-name"
        value={filters.name}
      />
      <TextInput
        accessibilityLabel="Filter by service UUID"
        autoCapitalize="characters"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onChangeText={serviceUuid => onChange({ ...filters, serviceUuid })}
        placeholder="Filter by service UUID (e.g. 180D)"
        placeholderTextColor={theme.colors.textSecondary}
        style={inputStyle}
        testID="filter-service"
        value={filters.serviceUuid}
      />
      <View accessibilityRole="radiogroup" style={styles.thresholds}>
        <ThresholdChip
          label="Any signal"
          selected={filters.minRssi === undefined}
          onPress={() => onChange({ ...filters, minRssi: undefined })}
          testID="filter-rssi-any"
        />
        {RSSI_THRESHOLDS.map(threshold => (
          <ThresholdChip
            key={threshold}
            label={`≥ ${threshold} dBm`}
            selected={filters.minRssi === threshold}
            onPress={() => onChange({ ...filters, minRssi: threshold })}
            testID={`filter-rssi-${Math.abs(threshold)}`}
          />
        ))}
      </View>
    </View>
  );
}

interface ThresholdChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}

function ThresholdChip({
  label,
  selected,
  onPress,
  testID,
}: ThresholdChipProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.colors.accent : theme.colors.surface,
        },
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.chipLabel,
          { color: selected ? theme.colors.onAccent : theme.colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: 8,
  },
  input: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  thresholds: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});
