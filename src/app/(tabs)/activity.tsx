import { StyleSheet, View } from 'react-native';

import { listMyRuns } from '@/api/runs';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useLoad } from '@/hooks/useLoad';
import { formatDuration, formatKm, formatPace, reasonText, shortDay, sourceLabel, weekTotals } from '@/lib/runs';
import { space, stroke } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

// Activity tab: your runs so far and this week's totals (free, PRD 7 "basic
// stats"). Pro analytics join here in milestone 7.
export default function ActivityTab() {
  const c = useColours();
  const runs = useLoad(listMyRuns);
  const list = runs.data ?? [];
  const week = weekTotals(list);

  return (
    <Screen>
      <Text variant="title">Activity</Text>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text variant="display" tabular>
            {(week.metres / 1000).toFixed(1)}
          </Text>
          <Text variant="label" colour="textSecondary">
            km this week
          </Text>
        </View>
        <View style={styles.stat}>
          <Text variant="display" tabular>
            {String(week.count)}
          </Text>
          <Text variant="label" colour="textSecondary">
            {week.count === 1 ? 'run this week' : 'runs this week'}
          </Text>
        </View>
      </View>

      {runs.error ? (
        <>
          <Text colour="textSecondary">{"We couldn't load your runs. Check your connection."}</Text>
          <Button label="Try again" onPress={runs.reload} />
        </>
      ) : null}

      {runs.data && list.length === 0 ? (
        <Text colour="textSecondary">No runs yet. Log one from the Run tab and it shows up here.</Text>
      ) : null}

      <View>
        {list.map((r, i) => (
          <View key={r.id} style={[styles.row, i > 0 && { borderTopWidth: stroke.thin, borderTopColor: c.divider }]}>
            <View style={styles.rowTop}>
              <Text variant="bodyStrong">{shortDay(new Date(r.started_at))}</Text>
              <Text variant="bodyStrong" tabular>
                {formatKm(r.distance_m)}
              </Text>
            </View>
            <Text variant="caption" colour="textSecondary" tabular>
              {`${formatDuration(r.duration_s)}  ${formatPace(r.distance_m, r.duration_s)}  ${sourceLabel(r.source)}`}
            </Text>
            {r.status === 'flagged' ? (
              <Text variant="caption" colour="danger">
                {`Not counted. ${r.flag_reasons.map(reasonText).join(' ')}`}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: 'row',
    gap: space.xl,
  },
  stat: {
    gap: space.xs,
  },
  row: {
    paddingVertical: space.md,
    gap: space.xs,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
