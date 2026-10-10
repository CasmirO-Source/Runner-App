import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { minTouchSize, pressedScale, radius, space } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

import { Text } from './Text';

type Props = {
  options: { label: string }[];
  selected: number;
  onSelect: (index: number) => void;
};

// A row of day buttons (today and the 7 days before). No date-picker package
// needed, and runs can only be logged for these days anyway (PRD 6.4).
export function DayPicker({ options, selected, onSelect }: Props) {
  const c = useColours();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="radiogroup">
      {options.map((o, i) => {
        const on = i === selected;
        return (
          <Pressable
            key={o.label}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(i)}
            onPressIn={() => {
              Haptics.selectionAsync().catch(() => {});
            }}
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? c.accent : pressed ? c.surfacePressed : c.surface,
                    transform: [{ scale: pressed ? pressedScale : 1 }],
                  },
                ]}
              >
                <Text variant="label" colour={on ? 'onAccent' : 'textPrimary'}>
                  {o.label}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: space.sm,
  },
  chip: {
    minHeight: minTouchSize,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
});
