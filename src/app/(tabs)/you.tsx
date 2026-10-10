import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useAuth } from '@/hooks/useAuth';
import { space } from '@/theme/tokens';

// You tab: your profile and sign out. Stride, rating history and duel record
// arrive in later milestones; settings (privacy, data export, delete account)
// in milestone 9.
export default function YouTab() {
  const { profile, session, signOut } = useAuth();
  if (!profile) return null;
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
