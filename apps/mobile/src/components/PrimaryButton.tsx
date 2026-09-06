import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/useTheme';

export interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  /** Spoken label when the visible text alone is not descriptive enough. */
  accessibilityLabel?: string;
  disabled?: boolean;
  testID?: string;
}

/** Full-width action button with a 48pt minimum touch target. */
export function PrimaryButton({
  label,
  onPress,
  accessibilityLabel,
  disabled = false,
  testID,
}: PrimaryButtonProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: theme.colors.accent,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}
      testID={testID}
    >
      <Text style={[styles.label, { color: theme.colors.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  label: {
    fontSize: 17,
    fontWeight: '600',
  },
});
