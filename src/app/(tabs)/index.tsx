import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { getCurrentSeason, getStandings, listMyLeagues } from '@/api/leagues';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ListItem } from '@/components/ListItem';
import { Screen } from '@/components/Screen';
import { StrideSummary } from '@/components/StrideSummary';
import { Text } from '@/components/Text';
import { useFreshProfile } from '@/hooks/useFreshProfile';
import { useLoad } from '@/hooks/useLoad';
import { daysLeftLabel, seasonName, standingLine } from '@/lib/leagues';
import type { Standing } from '@/types/league';
import { space } from '@/theme/tokens';

async function loadHome() {
  const [leagues, season] = await Promise.all([listMyLeagues(), getCurrentSeason()]);
  const standings: Record<string, Standing[]> = {};
  if (leagues.ok) {
    const tables = await Promise.all(leagues.data.map((l) => getStandings(l.id)));
    leagues.data.forEach((l, i) => {
      const t = tables[i];
      if (t.ok) standings[l.id] = t.data;
    });
  }
  return { leagues, season, standings };
}

// Home tab: your place in each league, the gap to the runner above, and the
// season countdown, and your Stride (PRD 13.3). Tapping a league opens it in the League tab.
export default function Home() {
  const { profile } = useFreshProfile();
  const loaded = useLoad(async () => ({ ok: true as const, data: await loadHome() }));
  if (!profile) return null;

  const leagues = loaded.data?.leagues.ok ? loaded.data.leagues.data : null;
  const season = loaded.data?.season.ok ? loaded.data.season.data : null;
  const failed = loaded.data !== null && !loaded.data.leagues.ok;
  const ownsOne = leagues?.some((l) => l.owner_id === profile.id) ?? false;

  return (
    <Screen>
      <View style={styles.row}>
        <Avatar avatarId={profile.avatar_id} />
        <Text variant="heading">{profile.display_name}</Text>
      </View>
      <StrideSummary fields={profile} compact />

      <View style={styles.heading}>
        <Text variant="title">Your leagues</Text>
        {season ? (
          <Text variant="label" colour="textSecondary" tabular>
            {`${seasonName(season.month)} season: ${daysLeftLabel(season.ends_at)}`}
          </Text>
        ) : null}
      </View>

      {failed ? (
        <>
          <Text colour="textSecondary">{"We couldn't load your leagues. Check your connection."}</Text>
          <Button label="Try again" onPress={loaded.reload} />
        </>
      ) : null}

      {leagues && leagues.length === 0 ? (
        <Text colour="textSecondary">No league yet. Start one and invite your mates, or join with a code from a friend.</Text>
      ) : null}

      {leagues?.map((l) => (
        <ListItem
          key={l.id}
          title={l.name}
          subtitle={standingLine(loaded.data?.standings[l.id] ?? [], profile.id) ?? (l.owner_id === profile.id ? 'You run this league' : 'Member')}
          onPress={() => router.navigate({ pathname: '/standings', params: { id: l.id } })}
        />
      ))}

      {leagues ? (
        <View style={styles.actions}>
          {ownsOne ? (
            <Text variant="caption" colour="textSecondary">
              You can run one league at a time.
            </Text>
          ) : (
            <Button label="Start a league" onPress={() => router.push('/league/new')} />
          )}
          <Button label="Join with a code" variant="secondary" onPress={() => router.push('/league/join')} />
        </View>
      ) : null}

    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  heading: {
    gap: space.xs,
  },
  actions: {
    gap: space.md,
  },
});
