import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Share, StyleSheet, View } from 'react-native';

import {
  createInvite,
  getActiveInvite,
  getCurrentSeason,
  getLeague,
  getStandings,
  leaveLeague,
  removeMember,
  revokeInvite,
} from '@/api/leagues';
import { Button } from './Button';
import { LinkButton } from './LinkButton';
import { StandingsTable } from './StandingsTable';
import { Text } from './Text';
import { useAuth } from '@/hooks/useAuth';
import { useLoad } from '@/hooks/useLoad';
import { daysLeftLabel, formatCode, seasonName, shareMessage, shortDate } from '@/lib/leagues';
import { space } from '@/theme/tokens';
import type { Standing } from '@/types/league';

type Loaded = Awaited<ReturnType<typeof loadLeague>>;

async function loadLeague(id: string) {
  const [league, standings, season, invite] = await Promise.all([
    getLeague(id),
    getStandings(id),
    getCurrentSeason(),
    getActiveInvite(id),
  ]);
  return { league, standings, season, invite };
}

// One league: its table, the season countdown and, for the owner, invites,
// removals and settings. Shown in the League tab. Everything comes from the
// database's access rules, so a non-member sees "not found" whatever ID is
// asked for.
export function LeagueView({ leagueId: id, onLeft }: { leagueId: string; onLeft: () => void }) {
  const { profile } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useLoad(async () => ({ ok: true as const, data: await loadLeague(id) }));

  const data: Loaded | null = loaded.data;
  if (!data || !profile) {
    return null;
  }

  const league = data.league.ok ? data.league.data : null;
  if (!league) {
    const failed = !data.league.ok;
    return (
      <View style={styles.section}>
        <Text variant="title">{failed ? 'No connection' : 'League not found'}</Text>
        <Text colour="textSecondary">
          {failed ? "We couldn't load this league. Check your connection." : "You're not in this league, or it has closed."}
        </Text>
        {failed ? <Button label="Try again" onPress={loaded.reload} /> : null}
      </View>
    );
  }

  const isOwner = league.owner_id === profile.id;
  const rows = data.standings.ok ? data.standings.data : [];
  const season = data.season.ok ? data.season.data : null;
  const invite = data.invite.ok ? data.invite.data : null;
  const othersRemain = rows.some((r) => r.user_id !== profile.id);

  async function run(action: () => Promise<{ ok: boolean; error?: { message: string } }>, done?: string) {
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setMessage(result.error?.message ?? 'Something went wrong.');
    else if (done) setMessage(done);
    loaded.reload();
  }

  function share() {
    if (!invite || !league) return;
    Share.share({ message: shareMessage(league.name, invite.code) }).catch(() => {});
  }

  function confirmRemove(row: Standing) {
    Alert.alert(`Remove ${row.display_name}?`, "They'll lose access to this league straight away.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => run(() => removeMember(league!.id, row.user_id)) },
    ]);
  }

  function confirmLeave() {
    const closing = isOwner;
    Alert.alert(
      closing ? 'Close this league?' : 'Leave this league?',
      closing ? 'You are the last member, so the league will close.' : "You'll need a new code to come back.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: closing ? 'Close league' : 'Leave',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const result = await leaveLeague(league!.id);
            setBusy(false);
            if (result.ok) onLeft();
            else setMessage(result.error.message);
          },
        },
      ],
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <Text variant="title">{league.name}</Text>
        {season ? (
          <Text variant="label" colour="textSecondary" tabular>
            {`${seasonName(season.month)} season: ${daysLeftLabel(season.ends_at)}`}
          </Text>
        ) : null}
        {league.verified_only ? (
          <Text variant="caption" colour="textSecondary">
            Verified runs only
          </Text>
        ) : null}
      </View>

      <View>
        <StandingsTable rows={rows} myId={profile.id} onRemove={isOwner ? confirmRemove : undefined} />
        <Text variant="caption" colour="textSecondary">
          {`${rows.length} of ${league.member_limit} places taken. Distances show here once you can log runs.`}
        </Text>
      </View>

      {message ? (
        <Text colour="textSecondary" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}

      {isOwner ? (
        <View style={styles.section}>
          <Text variant="heading">Invite your mates</Text>
          {invite ? (
            <>
              <Text variant="title" tabular accessibilityLabel={`Code ${invite.code.split('').join(' ')}`}>
                {formatCode(invite.code)}
              </Text>
              <Text variant="caption" colour="textSecondary">{`Works until ${shortDate(invite.expires_at)}`}</Text>
              <Button label="Share invite" onPress={share} />
              <LinkButton label="Make a new code" onPress={() => run(() => createInvite(league.id), 'New code ready. The old one no longer works.')} />
              <LinkButton label="Stop this code" tone="danger" onPress={() => run(() => revokeInvite(league.id), 'Code stopped.')} />
            </>
          ) : (
            <Button label={busy ? 'Making code' : 'Make an invite code'} disabled={busy} onPress={() => run(() => createInvite(league.id))} />
          )}
          <LinkButton label="League settings" onPress={() => router.push({ pathname: '/league/[id]/settings', params: { id: league.id } })} />
        </View>
      ) : null}

      {isOwner && othersRemain ? (
        <Text variant="caption" colour="textSecondary">
          You run this league. To leave, remove the other members first.
        </Text>
      ) : (
        <Button label={isOwner ? 'Close league' : 'Leave league'} variant="secondary" disabled={busy} onPress={confirmLeave} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: space.xl,
  },
  heading: {
    gap: space.xs,
  },
  section: {
    gap: space.md,
  },
});
