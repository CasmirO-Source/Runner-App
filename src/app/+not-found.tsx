import { router } from 'expo-router';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';

// Shown if the app is opened with a link to a screen that does not exist.
// Replaces Expo Router's default screen, which shows the requested path and
// developer details.
export default function NotFound() {
  return (
    <Screen>
      <Text variant="title">Wrong turn</Text>
      <Text colour="textSecondary">That page does not exist.</Text>
      <Button label="Back to the start" onPress={() => router.replace('/')} />
    </Screen>
  );
}
