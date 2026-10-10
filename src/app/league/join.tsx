import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { joinLeague } from '@/api/leagues';
import { Button } from '@/components/Button';
import { LinkButton } from '@/components/LinkButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { looksLikeCode, normaliseCode } from '@/lib/leagues';

export default function JoinLeague() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(typeof params.code === 'string' ? params.code : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    if (!looksLikeCode(code)) {
      setError('Codes are 10 letters and numbers. Check it and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await joinLeague(normaliseCode(code));
    setBusy(false);
    if (result.ok) {
      router.navigate({ pathname: '/standings', params: { id: result.data.league_id } });
      return;
    }
    setError(result.error.message);
  }

  return (
    <Screen>
      <LinkButton label="Back" onPress={() => router.back()} />
      <Text variant="title">Join a league</Text>
      <Text colour="textSecondary">Enter the code a mate sent you. Codes work for 7 days.</Text>
      <TextField
        label="Invite code"
        value={code}
        onChangeText={(t) => {
          setCode(t);
          setError(null);
        }}
        placeholder="ABCDE FGHJK"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        maxLength={14}
        returnKeyType="go"
        onSubmitEditing={join}
        error={error}
      />
      <Button label={busy ? 'Joining' : 'Join league'} onPress={join} disabled={busy} />
    </Screen>
  );
}
