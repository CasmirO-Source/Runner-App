import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { getLeague, updateLeague } from '@/api/leagues';
import { Button } from '@/components/Button';
import { LinkButton } from '@/components/LinkButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { ToggleRow } from '@/components/ToggleRow';
import { useLoad } from '@/hooks/useLoad';
import { leagueNameProblem, normaliseLeagueName } from '@/lib/leagues';
import type { League } from '@/types/league';

// Owner only. The server refuses changes from anyone else, whatever this
// screen shows.
export default function LeagueSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const loaded = useLoad(() => getLeague(id));
  if (!loaded.data) {
    return (
      <Screen>
        <LinkButton label="Back" onPress={() => router.back()} />
        {loaded.error || (!loaded.loading && !loaded.data) ? <Text colour="textSecondary">{"We couldn't load this league."}</Text> : null}
      </Screen>
    );
  }
  return <SettingsForm league={loaded.data} />;
}

function SettingsForm({ league }: { league: League }) {
  const [name, setName] = useState(league.name);
  const [verifiedOnly, setVerifiedOnly] = useState(league.verified_only);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const problem = leagueNameProblem(name);
    if (problem) {
      setFieldError(problem);
      return;
    }
    const changes: { name?: string; verified_only?: boolean } = {};
    if (normaliseLeagueName(name) !== league.name) changes.name = normaliseLeagueName(name);
    if (verifiedOnly !== league.verified_only) changes.verified_only = verifiedOnly;
    if (Object.keys(changes).length === 0) {
      router.back();
      return;
    }
    setBusy(true);
    const result = await updateLeague(league.id, changes);
    setBusy(false);
    if (result.ok) {
      router.back();
      return;
    }
    if (result.error.fields?.name) setFieldError(result.error.fields.name);
    else setError(result.error.message);
  }

  return (
    <Screen>
      <LinkButton label="Back" onPress={() => router.back()} />
      <Text variant="title">League settings</Text>
      <TextField
        label="League name"
        value={name}
        onChangeText={(t) => {
          setName(t);
          setFieldError(null);
        }}
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={30}
        error={fieldError}
      />
      <ToggleRow
        label="Verified runs only"
        description="Only runs recorded by a watch or phone (Apple Health or Health Connect) count."
        value={verifiedOnly}
        onChange={setVerifiedOnly}
      />
      {error ? (
        <Text variant="caption" colour="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label={busy ? 'Saving' : 'Save'} onPress={save} disabled={busy} />
    </Screen>
  );
}
