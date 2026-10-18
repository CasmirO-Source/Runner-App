import { StyleSheet, View } from 'react-native';

import { tableTier } from '@/lib/stride';
import { space, stroke } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';
import type { Standing } from '@/types/league';

import { Avatar } from './Avatar';
import { LinkButton } from './LinkButton';
import { Text } from './Text';

type Props = {
  rows: Standing[];
  myId: string;
  // Shown to the league owner: a remove action on every other row.
  onRemove?: (row: Standing) => void;
};

// The league table: place, avatar, name with Stride tier (PRD 5.2), distance. Numbers use fixed-width
// digits so columns line up (PRD 13.1). Rows are separated by thin neutral
// dividers, not boxes.
export function StandingsTable({ rows, myId, onRemove }: Props) {
  const c = useColours();
  return (
    <View accessibilityRole="list">
      {rows.map((row, i) => {
        const me = row.user_id === myId;
        const tier = tableTier(row);
        return (
          <View
            key={row.user_id}
            accessibilityLabel={`${row.place}, ${row.display_name}${me ? ', you' : ''}${tier ? `, ${tier}` : ''}, ${(row.distance_m / 1000).toFixed(1)} kilometres`}
            style={[styles.row, i > 0 && { borderTopWidth: stroke.thin, borderTopColor: c.divider }]}
          >
            <View style={styles.place}>
              <Text variant="heading" tabular>
                {String(row.place)}
              </Text>
            </View>
            <Avatar avatarId={row.avatar_id} size={space.xxl} />
            <View style={styles.name}>
              <Text variant={me ? 'bodyStrong' : 'body'} numberOfLines={1}>
                {me ? `${row.display_name} (you)` : row.display_name}
              </Text>
              {tier ? (
                <Text variant="caption" colour="textSecondary">
                  {tier}
                </Text>
              ) : null}
            </View>
            <Text variant="bodyStrong" tabular>
              {`${(row.distance_m / 1000).toFixed(1)} km`}
            </Text>
            {onRemove && !me ? <LinkButton label="Remove" tone="danger" onPress={() => onRemove(row)} /> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  place: {
    width: space.xl,
  },
  name: {
    flex: 1,
  },
});
