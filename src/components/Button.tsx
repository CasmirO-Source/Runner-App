import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { minTouchSize, pressedScale, radius, space } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

import { Text } from './Text';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  accessibilityHint?: string;
};

// Appendix B #14: the pressed state changes colour AND size, and gives a light
// vibration. It never just fades.
export function Button({ label, onPress, variant = 'primary', disabled = false, accessibilityHint }: Props) {
  const c = useColours();
  const primary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        // Fire and forget: a phone without haptics must never break the button.
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.base,
            {
              backgroundColor: disabled
                ? c.surface
                : primary
                  ? pressed
                    ? c.accentPressed
                    : c.accent
                  : pressed
                    ? c.surfacePressed
                    : c.surface,
              transform: [{ scale: pressed && !disabled ? pressedScale : 1 }],
            },
          ]}
        >
          <Text variant="label" colour={disabled ? 'textSecondary' : primary ? 'onAccent' : 'textPrimary'}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTouchSize,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
