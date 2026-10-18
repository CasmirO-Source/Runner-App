import { Redirect, router } from 'expo-router';

import { EstimateForm } from '@/components/EstimateForm';
import { LinkButton } from '@/components/LinkButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useOnboardingDraft } from '@/hooks/useOnboardingDraft';

// Step 3 of 4: your running, for an estimated Stride from day one (PRD 4.5).
// Optional. The answers stay in memory until the last step sends them.
export default function RunningStep() {
  const { over18, displayName, estimate, setEstimate } = useOnboardingDraft();

  if (!over18 || !displayName) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <Screen>
      <Text variant="caption" colour="textSecondary">Step 3 of 4</Text>
      <Text variant="title">How do you run now?</Text>
      <Text colour="textSecondary">
        Two quick answers give you an estimated Stride straight away. After 3 verified runs, your real Stride replaces it.
      </Text>
      <EstimateForm
        initial={estimate}
        submitLabel="Next"
        onSubmit={(value) => {
          setEstimate(value);
          router.push('/onboarding/avatar');
        }}
      />
      <LinkButton
        label="Skip for now"
        onPress={() => {
          setEstimate(null);
          router.push('/onboarding/avatar');
        }}
      />
    </Screen>
  );
}
