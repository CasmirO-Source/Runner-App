import { StyleSheet, View } from 'react-native';

import { AVATARS } from '@/lib/avatars';
import { space } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

type Props = {
  avatarId: number;
  size?: typeof space.xxl | typeof space.xxxl;
};

// Draws a preset avatar: a flat disc with a simple mark punched out in the
// background colour. Solid shapes only, no gradients, images or textures.
export function Avatar({ avatarId, size = space.xxxl }: Props) {
  const c = useColours();
  const preset = AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0];
  const tone = c.avatarTones[preset.tone];
  const cut = c.background;
  const half = size / 2;

  return (
    <View
      accessible={false}
      style={[styles.disc, { width: size, height: size, borderRadius: half, backgroundColor: tone }]}
    >
      {preset.mark === 'dot' && (
        <View style={{ width: size / 3, height: size / 3, borderRadius: size / 6, backgroundColor: cut }} />
      )}
      {preset.mark === 'bar' && <View style={{ width: size * 0.6, height: size / 6, backgroundColor: cut }} />}
      {preset.mark === 'ring' && (
        <View
          style={{ width: size * 0.56, height: size * 0.56, borderRadius: size * 0.28, borderWidth: size / 10, borderColor: cut }}
        />
      )}
      {preset.mark === 'split' && (
        <View style={[StyleSheet.absoluteFill, { left: half, backgroundColor: cut }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
