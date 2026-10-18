import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { getMyRatingHistory } from '@/api/stride';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { LinkButton } from '@/components/LinkButton';
import { Screen } from '@/components/Screen';
import { StrideChart } from '@/components/StrideChart';
import { StrideSummary } from '@/components/StrideSummary';
import { Text } from '@/components/Text';
import { useFreshProfile } from '@/hooks/useFreshProfile';
import { useLoad } from '@/hooks/useLoad';
import { estimateVerdict } from '@/lib/stride';
import { space } from '@/theme/tokens';

// You tab: your profile, Stride, tier and rating history (PRD 13.3 screen 8),
// and sign out. Duel record arrives in milestone 6; settings (privacy, data
// export, delete account) in milestone 9.
export default function YouTab() {
  const { profile, session, signOut } = useFreshProfile();
  const history = useLoad(getMyRatingHistory);
  if (!profile) return null;

  const placed = profile.stride !== null;
  const verdict = estimateVerdict(profile);

  return (
    <Screen>
      <Text variant="title">You</Text>
      <View style={styles.row}>
        <Avatar avatarId={profile.avatar_id} />
        <View style={styles.text}>
          <Text variant="heading">{profile.display_name}</Text>
          {session?.user.email ? (
            <Text variant="caption" colour="textSecondary">{`Signed in as ${session.user.email}`}</Text>
          ) : null}
        </View>
      </View>

      <StrideSummary fields={profile} />
      {verdict ? <Text>{verdict}</Text> : null}
      {placed && history.data ? <StrideChart history={history.data} /> : null}
      {placed ? null : (
        <LinkButton
          label={profile.estimated_stride === null ? 'Estimate my Stride' : 'Change my estimate'}
          onPress={() => router.push('/estimate')}
        />
      )}

      <View style={styles.text}>
        <Text variant="heading">How Stride works</Text>
        <Text colour="textSecondary">
          A number from 0 to 3000: three quarters speed, one quarter weekly distance. Speed is the middle of your best three verified
          runs of 3 to 21.1 km in the last 60 days, so a slow day never counts against you.
        </Text>
        <Text colour="textSecondary">
          It rises straight away when you run faster or further, and falls by at most 150 a week. Only runs synced from Apple Health or
          Health Connect count.
        </Text>
      </View>

      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  text: {
    flex: 1,
    gap: space.xs,
  },
});
