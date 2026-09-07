import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  bytesToHex,
  parseByteInput,
  type ByteInputMode,
  type CharacteristicProperty,
  type WriteMode,
} from '@beacon/ble-contracts';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useTheme } from '../../theme/useTheme';

export interface WriteFormProps {
  properties: CharacteristicProperty[];
  /** False while the link is not ready or another operation is in flight. */
  enabled: boolean;
  busy: boolean;
  onWrite: (bytes: number[], mode: WriteMode) => void;
}

const MODES: Array<{ mode: ByteInputMode; label: string; placeholder: string }> = [
  { mode: 'hex', label: 'HEX', placeholder: 'e.g. 02 9A 1C' },
  { mode: 'decimal', label: 'Decimal', placeholder: 'e.g. 2 154 28' },
  { mode: 'utf8', label: 'UTF-8', placeholder: 'e.g. Hello' },
];

/**
 * Write input with a mode selector (PROJECT.md 15). The text is parsed on
 * every change so the validation message and the byte preview are always in
 * step with what the field holds, and the write buttons stay disabled until
 * the input is valid and non-empty.
 */
export function WriteForm({
  properties,
  enabled,
  busy,
  onWrite,
}: WriteFormProps): React.JSX.Element {
  const theme = useTheme();
  const [mode, setMode] = useState<ByteInputMode>('hex');
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseByteInput(mode, text), [mode, text]);
  const bytes = parsed.ok ? parsed.bytes : [];
  const canSubmit = enabled && parsed.ok && bytes.length > 0;
  const withResponse = properties.includes('write');
  const withoutResponse = properties.includes('write_without_response');
  const placeholder = MODES.find(item => item.mode === mode)?.placeholder;

  return (
    <View
      style={[styles.form, { backgroundColor: theme.colors.surface }]}
      testID="write-form"
    >
      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Write</Text>
      <View accessibilityRole="radiogroup" style={styles.modes}>
        {MODES.map(item => (
          <ModeChip
            key={item.mode}
            label={item.label}
            selected={mode === item.mode}
            onPress={() => setMode(item.mode)}
            testID={`write-mode-${item.mode}`}
          />
        ))}
      </View>
      <TextInput
        accessibilityLabel={`Value to write, ${MODES.find(item => item.mode === mode)?.label}`}
        autoCapitalize={mode === 'hex' ? 'characters' : 'none'}
        autoCorrect={false}
        editable={!busy}
        keyboardType={mode === 'decimal' ? 'number-pad' : 'default'}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textSecondary}
        style={[
          styles.input,
          mode === 'utf8' ? null : styles.monospace,
          { backgroundColor: theme.colors.background, color: theme.colors.textPrimary },
        ]}
        testID="write-input"
        value={text}
      />
      <Text
        accessibilityLiveRegion="polite"
        style={[
          styles.feedback,
          { color: parsed.ok ? theme.colors.textSecondary : theme.colors.textPrimary },
        ]}
        testID="write-feedback"
      >
        {parsed.ok ? describePreview(bytes) : parsed.message}
      </Text>
      {withResponse ? (
        <PrimaryButton
          label={busy ? 'Writing…' : 'Write with response'}
          onPress={() => onWrite(bytes, 'with_response')}
          disabled={!canSubmit}
          testID="write-with-response"
        />
      ) : null}
      {withoutResponse ? (
        <PrimaryButton
          label={busy ? 'Writing…' : 'Write without response'}
          onPress={() => onWrite(bytes, 'without_response')}
          disabled={!canSubmit}
          testID="write-without-response"
        />
      ) : null}
    </View>
  );
}

function describePreview(bytes: number[]): string {
  if (bytes.length === 0) {
    return 'Enter a value to write.';
  }
  const count = bytes.length === 1 ? '1 byte' : `${bytes.length} bytes`;
  return `${count}: ${bytesToHex(bytes)}`;
}

interface ModeChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}

function ModeChip({
  label,
  selected,
  onPress,
  testID,
}: ModeChipProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: selected ? theme.colors.accent : theme.colors.background },
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
  form: {
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modes: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  monospace: {
    fontFamily: 'monospace',
  },
  feedback: {
    fontSize: 14,
  },
});
