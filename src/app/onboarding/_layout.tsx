import { Stack } from 'expo-router';

import { OnboardingDraftProvider } from '@/hooks/useOnboardingDraft';
import { useColours } from '@/theme/useTheme';

export default function OnboardingLayout() {
  const c = useColours();
  return (
    <OnboardingDraftProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }} />
    </OnboardingDraftProvider>
  );
}
