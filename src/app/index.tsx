import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';

// Temporary first screen so the app shell runs. Replaced by the sign-in flow in
// step 6.
export default function Index() {
  return (
    <Screen>
      <Text variant="title">Setting up</Text>
      <Text colour="textSecondary">Sign-in arrives in the next build.</Text>
    </Screen>
  );
}
