import { router } from 'expo-router';
import { useState } from 'react';

import { fromAuthError } from '@/api/errors';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { looksLikeEmail, normaliseEmail } from '@/lib/validation';

// Email one-time code sign-in (PRD 5.1, milestone 1). No passwords. The same
// screen signs up new runners and signs in returning ones, and the response is
// the same either way, so it never reveals whether an email has an account.
export default function SignIn() {
  const { setPendingEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    if (!looksLikeEmail(email)) {
      setError('Check your email address.');
      return;
    }
    const address = normaliseEmail(email);
    setBusy(true);
    setError(null);
    setRateLimited(false);
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (authError) {
      const appError = fromAuthError(authError, 'send');
      setError(appError.message);
      setRateLimited(appError.code === 'rate_limited');
      return;
    }
    setPendingEmail(address);
    router.push('/verify');
  }

  function useExistingCode() {
    setPendingEmail(normaliseEmail(email));
    router.push('/verify');
  }

  return (
    <Screen>
      <Text variant="display">Sign in</Text>
      <Text colour="textSecondary">{"We'll email you a 6-digit code. No passwords."}</Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={254}
        returnKeyType="send"
        onSubmitEditing={sendCode}
        error={error}
      />
      <Button label={busy ? 'Sending' : 'Send code'} onPress={sendCode} disabled={busy} />
      {rateLimited ? <Button label="I have a code" variant="secondary" onPress={useExistingCode} /> : null}
    </Screen>
  );
}
