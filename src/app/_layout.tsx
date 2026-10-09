import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useColours } from '@/theme/useTheme';

// Root navigator. Sign-in, onboarding and the signed-in area are added in
// step 6, with a guard that sends signed-out users to the sign-in screen.
export default function RootLayout() {
  const c = useColours();
  // Only the two weights the design uses are loaded, so the app ships two font
  // files rather than eighteen. Italics are never loaded (Appendix B #18).
  const [fontsLoaded, fontError] = useFonts({ BarlowCondensed_600SemiBold, BarlowCondensed_700Bold });

  // If the font fails to load, carry on with the system font rather than
  // leaving the user on a blank screen.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }} />
    </>
  );
}
