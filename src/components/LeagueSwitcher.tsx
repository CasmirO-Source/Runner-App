import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { minTouchSize, pressedScale, radius, space } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';
import type { League } from '@/types/league';

import { Text } from './Text';

type Props = {
  leagues: League[];
  selectedId: string;
  onSelect: (id: string) => void;
};

// Shown in the League tab when you are in more than one league.
export function LeagueSwitcher({ leagues, selectedId, onSelect }: Props) {
  const c = useColours();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="tablist">
      {leagues.map((l) => {
        const selected = l.id === selectedId;
        return (
          <Pressable
            key={l.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onSelect(l.id)}
            onPressIn={() => {
              Haptics.selectionAsync().catch(() => {});
            }}
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? c.accent : pressed ? c.surfacePressed : c.surface,
                    transform: [{ scale: pressed ? pressedScale : 1 }],
                  },
                ]}
              >
                <Text variant="label" colour={selected ? 'onAccent' : 'textPrimary'} numberOfLines={1}>
                  {l.name}
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
