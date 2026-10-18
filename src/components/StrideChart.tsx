import { StyleSheet, View } from 'react-native';

import type { Rating } from '@/api/stride';
import { barHeights } from '@/lib/stride';
import { radius, space } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

import { Text } from './Text';

const HEIGHT = space.xxxl * 2;

// Stride history as bars, oldest on the left, drawn from plain views (no chart
// package). The latest rating is in the accent colour.
export function StrideChart({ history }: { history: Rating[] }) {
  const c = useColours();
  if (history.length === 0) return null;
  const heights = barHeights(
    history.map((h) => h.stride),
    HEIGHT,
    space.xs,
  );
  const first = history[0].stride;
  const last = history[history.length - 1].stride;
  return (
    <View style={styles.group}>
      <Text variant="label" colour="textSecondary">{`Your last ${history.length} ratings`}</Text>
      <View
        style={styles.bars}
        accessible
        accessibilityLabel={`Stride history: ${history.length} ratings, from ${first} to ${last}`}
      >
        {heights.map((h, i) => (
          <View
            key={history[i].created_at + i}
            style={[styles.bar, { height: h, backgroundColor: i === heights.length - 1 ? c.accent : c.inputBorder }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: space.sm,
  },
  bars: {
    height: HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xs,
  },
  bar: {
    flex: 1,
    borderRadius: radius.sm,
  },
});
