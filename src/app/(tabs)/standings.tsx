import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { listMyLeagues } from '@/api/leagues';
import { Button } from '@/components/Button';
import { LeagueSwitcher } from '@/components/LeagueSwitcher';
import { LeagueView } from '@/components/LeagueView';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useLoad } from '@/hooks/useLoad';
import { space } from '@/theme/tokens';

// League tab: your league's table, one tap from anywhere. With more than one
// league, a switcher at the top picks which one (remembered in the route).
export default function LeagueTab() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const leagues = useLoad(listMyLeagues);

  if (leagues.loading && !leagues.data) return <Screen>{null}</Screen>;

  if (leagues.error) {
    return (
      <Screen>
        <Text variant="title">League</Text>
        <Text colour="textSecondary">{"We couldn't load your leagues. Check your connection."}</Text>
        <Button label="Try again" onPress={leagues.reload} />
      </Screen>
    );
  }

  const list = leagues.data ?? [];
  if (list.length === 0) {
    return (
      <Screen>
        <Text variant="title">League</Text>
        <Text colour="textSecondary">No league yet. Start one and invite your mates, or join with a code from a friend.</Text>
        <View style={styles.actions}>
          <Button label="Start a league" onPress={() => router.push('/league/new')} />
          <Button label="Join with a code" variant="secondary" onPress={() => router.push('/league/join')} />
        </View>
      </Screen>
    );
  }

  const selected = list.find((l) => l.id === id) ?? list[0];
  return (
    <Screen>
      {list.length > 1 ? <LeagueSwitcher leagues={list} selectedId={selected.id} onSelect={(next) => router.setParams({ id: next })} /> : null}
      <LeagueView
        key={selected.id}
        leagueId={selected.id}
        onLeft={() => {
          router.setParams({ id: undefined });
          leagues.reload();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: space.md,
  },
});
