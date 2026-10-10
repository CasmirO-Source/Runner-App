import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { useColours } from '@/theme/useTheme';

export default function RootLayout() {
  // Only the two weights the design uses are loaded. Italics are never loaded
  // (Appendix B #18).
  const [fontsLoaded, fontError] = useFonts({ BarlowCondensed_600SemiBold, BarlowCondensed_700Bold });

  // If the font fails to load, carry on with the system font rather than
  // leaving the user on a blank screen.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </AuthProvider>
  );
}

// Each group of screens only exists while its guard is true. A signed-out
// user cannot reach onboarding or the app, even by deep link: those routes are
// simply not there, and Expo Router sends them to the first screen that is.
// This is for the user's journey only. Data is protected by the server (row-
// level security and Edge Functions), never by which screens the app shows.
function RootNavigator() {
  const { status, retry, signOut } = useAuth();
  const c = useColours();

  if (status === 'loading') {
    return <View style={{ flex: 1, backgroundColor: c.background }} />;
  }

  if (status === 'error') {
    return (
      <Screen>
        <Text variant="title">No connection</Text>
        <Text colour="textSecondary">{"We couldn't load your profile. Check your connection and try again."}</Text>
        <Button label="Try again" onPress={retry} />
        <Button label="Sign out" variant="secondary" onPress={signOut} />
      </Screen>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="verify" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'needsProfile'}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'ready'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="league" />
        <Stack.Screen name="join/[code]" />
        <Stack.Screen name="screenshot" />
      </Stack.Protected>
    </Stack>
  );
}
