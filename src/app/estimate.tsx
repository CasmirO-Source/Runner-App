import { router } from 'expo-router';
import { useState } from 'react';

import { saveEstimate } from '@/api/stride';
import { EstimateForm } from '@/components/EstimateForm';
import { LinkButton } from '@/components/LinkButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useAuth } from '@/hooks/useAuth';
import type { StrideEstimate } from '@/types/profile';

// Add, change or remove your estimated Stride (PRD 4.5). Only until you are
// placed: after that your Stride comes from your runs, and the server refuses.
export default function EstimateScreen() {
  const { profile, setProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!profile) return null;

  const placed = profile.stride !== null;
  const initial: StrideEstimate | null =
    profile.estimate_weekly_km !== null ? { five_k_s: profile.estimate_5k_s, weekly_km: profile.estimate_weekly_km } : null;

  async function save(value: StrideEstimate | null) {
    setBusy(true);
    setError(null);
    const result = await saveEstimate(value);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.ref ? `${result.error.message} (ref ${result.error.ref})` : result.error.message);
      return;
    }
    setProfile(result.data);
    router.back();
  }

  return (
    <Screen>
      <LinkButton label="Back" onPress={() => router.back()} />
      <Text variant="title">Your estimate</Text>
      {placed ? (
        <Text colour="textSecondary">Your Stride comes from your runs now, so the estimate is closed.</Text>
      ) : (
        <>
          <Text colour="textSecondary">
            Two answers give an estimated Stride, shown with &quot;est.&quot; until 3 verified runs give you a real one. It never counts for
            anything.
          </Text>
          <EstimateForm initial={initial} submitLabel="Save estimate" busy={busy} error={error} onSubmit={save} />
          {initial ? <LinkButton label="Remove my estimate" tone="danger" onPress={() => save(null)} /> : null}
        </>
      )}
    </Screen>
  );
}
