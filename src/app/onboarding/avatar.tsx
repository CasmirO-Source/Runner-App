import { Redirect, router } from 'expo-router';
import { useState } from 'react';

import { createProfile } from '@/api/profile';
import { AvatarPicker } from '@/components/AvatarPicker';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useAuth } from '@/hooks/useAuth';

import { useOnboardingDraft } from '@/hooks/useOnboardingDraft';

// Step 3 of 3: avatar, then the profile is created through the profile Edge
// Function. If the server rejects the name (taken or not allowed), the user is
// taken back to the name step with the server's message.
export default function AvatarStep() {
  const { over18, displayName, setNameError } = useOnboardingDraft();
  const { setProfile } = useAuth();
  const [avatarId, setAvatarId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!over18 || !displayName) {
    return <Redirect href="/onboarding" />;
  }

  async function finish() {
    if (avatarId === null) {
      setError('Pick an avatar.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createProfile({ display_name: displayName, avatar_id: avatarId, over_18: true });
    setBusy(false);
    if (result.ok) {
      // The navigator sees the new profile and opens the app.
      setProfile(result.data);
      return;
    }
    const nameProblem = result.error.fields?.display_name;
    if (nameProblem) {
      setNameError(nameProblem);
      router.back();
      return;
    }
    setError(result.error.ref ? `${result.error.message} (ref ${result.error.ref})` : result.error.message);
  }

  return (
    <Screen>
      <Text variant="caption" colour="textSecondary">Step 3 of 3</Text>
      <Text variant="title">Pick an avatar</Text>
      <AvatarPicker
        value={avatarId}
        onChange={(id) => {
          setAvatarId(id);
          setError(null);
        }}
      />
      {error ? (
        <Text variant="caption" colour="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label={busy ? 'Saving' : 'Finish'} onPress={finish} disabled={busy} />
    </Screen>
  );
}
