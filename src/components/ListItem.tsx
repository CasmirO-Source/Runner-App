import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { minTouchSize, pressedScale, radius, space } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

import { Text } from './Text';

type Props = {
  title: string;
  subtitle?: string;
  onPress: () => void;
};

// A tappable row on a solid surface (no coloured borders, Appendix B #5).
export function ListItem({ title, subtitle, onPress }: Props) {
  const c = useColours();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      onPressIn={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.row,
            {
              backgroundColor: pressed ? c.surfacePressed : c.surface,
              transform: [{ scale: pressed ? pressedScale : 1 }],
            },
          ]}
        >
          <Text variant="heading">{title}</Text>
          {subtitle ? (
            <Text variant="caption" colour="textSecondary">
              {subtitle}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: minTouchSize,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    gap: space.xs,
  },
});
