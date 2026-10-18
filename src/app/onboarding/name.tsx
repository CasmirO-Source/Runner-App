import { Redirect, router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { displayNameProblem, normaliseDisplayName } from '@/lib/validation';

import { useOnboardingDraft } from '@/hooks/useOnboardingDraft';

// Step 2 of 4: display name. Checked here for quick feedback; the server and
// database decide (rules, word screen, and whether the name is taken).
export default function NameStep() {
  const { over18, displayName, setDisplayName, nameError, setNameError } = useOnboardingDraft();
  const [value, setValue] = useState(displayName);
  const [error, setError] = useState<string | null>(null);
  // A message from the server (name taken or not allowed) wins until the user
  // edits the name.
  const shownError = nameError ?? error;

  if (!over18) {
    return <Redirect href="/onboarding" />;
  }

  function next() {
    const problem = displayNameProblem(value);
    if (problem) {
      setError(problem);
      return;
    }
    setDisplayName(normaliseDisplayName(value));
    setNameError(null);
    router.push('/onboarding/running');
  }

  return (
    <Screen>
      <Text variant="caption" colour="textSecondary">Step 2 of 4</Text>
      <Text variant="title">Pick a name</Text>
      <Text colour="textSecondary">This is what your mates see on the leaderboard. 3 to 20 letters, numbers, spaces or underscores.</Text>
      <TextField
        label="Display name"
        value={value}
        onChangeText={(t) => {
          setValue(t);
          setError(null);
          setNameError(null);
        }}
        placeholder="Fast_Sam"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        maxLength={20}
        returnKeyType="next"
        onSubmitEditing={next}
        error={shownError}
      />
      <Button label="Next" onPress={next} />
    </Screen>
  );
}
