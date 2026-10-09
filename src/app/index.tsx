import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useAuth } from '@/hooks/useAuth';
import { space } from '@/theme/tokens';

// Signed-in holding screen for milestone 1. The real home screen (league
// position, gap, days left, Stride) arrives with leagues in milestone 2.
export default function Home() {
  const { profile, signOut } = useAuth();
  if (!profile) return null;

  return (
    <Screen>
      <View style={styles.row}>
        <Avatar avatarId={profile.avatar_id} />
        <Text variant="heading">{profile.display_name}</Text>
      </View>
      <Text variant="title">You're in</Text>
      <Text colour="textSecondary">Leagues are next. Soon you'll start one and invite your mates.</Text>
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
});
