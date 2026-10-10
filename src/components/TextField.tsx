import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { minTouchSize, radius, space, stroke, typography } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

import { Text } from './Text';

type Props = Pick<
  TextInputProps,
  | 'value'
  | 'onChangeText'
  | 'placeholder'
  | 'autoComplete'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'keyboardType'
  | 'textContentType'
  | 'inputMode'
  | 'maxLength'
  | 'onSubmitEditing'
  | 'returnKeyType'
  | 'autoFocus'
> & {
  label: string;
  error?: string | null;
  hint?: string;
};

// A labelled text input. The border is neutral (never coloured, Appendix B #5)
// and darkens to the primary text colour when focused.
export function TextField({ label, error, hint, ...inputProps }: Props) {
  const c = useColours();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      <Text variant="label">{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        accessibilityHint={hint}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={c.textSecondary}
        selectionColor={c.accent}
        maxFontSizeMultiplier={1.6}
        style={[
          styles.input,
          typography.body,
          {
            color: c.textPrimary,
            backgroundColor: c.surface,
            borderColor: focused ? c.textPrimary : c.inputBorder,
          },
        ]}
      />
      {error ? (
        <Text variant="caption" colour="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" colour="textSecondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: space.sm,
  },
  input: {
    minHeight: minTouchSize,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderWidth: stroke.thin,
    borderRadius: radius.md,
  },
});
