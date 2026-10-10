import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { minTouchSize, pressedScale, radius, space } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

import { Text } from './Text';

type Props = {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'danger';
  accessibilityHint?: string;
};

// A smaller, text-style action ("Back", "Remove", "New code"). Like Button, a
// press changes the background and size and gives a light vibration
// (Appendix B #14).
export function LinkButton({ label, onPress, tone = 'accent', accessibilityHint }: Props) {
  const c = useColours();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.base,
            {
              backgroundColor: pressed ? c.surfacePressed : 'transparent',
              transform: [{ scale: pressed ? pressedScale : 1 }],
            },
          ]}
        >
          <Text variant="label" colour={tone === 'danger' ? 'danger' : 'accentText'}>
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
    paddingHorizontal: space.sm,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.md,
  },
});
