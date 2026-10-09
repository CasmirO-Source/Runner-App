import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { AVATARS } from '@/lib/avatars';
import { pressedScale, space, stroke } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

import { Avatar } from './Avatar';

type Props = {
  value: number | null;
  onChange: (avatarId: number) => void;
};

// Grid of the 12 preset avatars, four to a row. The chosen one gets a neutral
// ring in the primary text colour. Each press scales down and ticks.
export function AvatarPicker({ value, onChange }: Props) {
  const c = useColours();
  return (
    <View accessibilityRole="radiogroup" style={styles.grid}>
      {AVATARS.map((preset) => {
        const selected = preset.id === value;
        return (
          <Pressable
            key={preset.id}
            accessibilityRole="radio"
            accessibilityLabel={preset.label}
            accessibilityState={{ selected }}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(preset.id);
            }}
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.slot,
                  {
                    borderColor: selected ? c.textPrimary : c.background,
                    backgroundColor: pressed ? c.surfacePressed : c.background,
                    transform: [{ scale: pressed ? pressedScale : 1 }],
                  },
                ]}
              >
                <Avatar avatarId={preset.id} />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  slot: {
    padding: space.xs,
    borderWidth: stroke.thick,
    borderRadius: space.xxxl,
  },
});
