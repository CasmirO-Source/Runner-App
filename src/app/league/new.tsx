import { router } from 'expo-router';
import { useState } from 'react';

import { createLeague } from '@/api/leagues';
import { Button } from '@/components/Button';
import { LinkButton } from '@/components/LinkButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { ToggleRow } from '@/components/ToggleRow';
import { leagueNameProblem, normaliseLeagueName } from '@/lib/leagues';

export default function NewLeague() {
  const [name, setName] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    const problem = leagueNameProblem(name);
    if (problem) {
      setFieldError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createLeague(normaliseLeagueName(name), verifiedOnly);
    setBusy(false);
    if (result.ok) {
      router.replace({ pathname: '/league/[id]', params: { id: result.data.league.id } });
      return;
    }
    if (result.error.fields?.name) setFieldError(result.error.fields.name);
    else setError(result.error.ref ? `${result.error.message} (ref ${result.error.ref})` : result.error.message);
  }

  return (
    <Screen>
      <LinkButton label="Back" onPress={() => router.back()} />
      <Text variant="title">Start a league</Text>
      <Text colour="textSecondary">Up to 8 runners. Each month is a new season, and most distance wins.</Text>
      <TextField
        label="League name"
        value={name}
        onChangeText={(t) => {
          setName(t);
          setFieldError(null);
        }}
        placeholder="Leeds Lunch Club"
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={30}
        error={fieldError}
      />
      <ToggleRow
        label="Verified runs only"
        description="Only runs recorded by a watch or phone (Apple Health or Health Connect) count. You can change this later."
        value={verifiedOnly}
        onChange={setVerifiedOnly}
      />
      {error ? (
        <Text variant="caption" colour="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label={busy ? 'Starting' : 'Start league'} onPress={start} disabled={busy} />
    </Screen>
  );
}
