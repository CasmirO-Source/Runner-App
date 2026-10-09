import { Redirect, router } from 'expo-router';
import { useState } from 'react';

import { fromAuthError } from '@/api/errors';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { cleanCode } from '@/lib/validation';

// Second half of sign-in: the 6-digit code. Codes work once and run out after
// 10 minutes (set in Supabase Auth). On success Supabase stores the session in
// secure storage and the navigator moves on by itself.
export default function Verify() {
  const { pendingEmail, setPendingEmail } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!pendingEmail) {
    return <Redirect href="/sign-in" />;
  }
  const email = pendingEmail;

  async function verify() {
    if (code.length !== 6) {
      setError('Enter all 6 digits.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    setBusy(false);
    if (authError) {
      setError(fromAuthError(authError, 'verify').message);
      setCode('');
    }
  }

  async function resend() {
    setNotice(null);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (authError) {
      setError(fromAuthError(authError, 'send').message);
    } else {
      setNotice('New code sent. Use the latest one.');
    }
  }

  function changeEmail() {
    setPendingEmail(null);
    router.back();
  }

  return (
    <Screen>
      <Text variant="display">Check your email</Text>
      <Text colour="textSecondary">We sent a 6-digit code to {email}. It runs out in 10 minutes.</Text>
      <TextField
        label="Code"
        value={code}
        onChangeText={(t) => setCode(cleanCode(t))}
        placeholder="123456"
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={verify}
        error={error}
      />
      {notice ? <Text colour="textSecondary">{notice}</Text> : null}
      <Button label={busy ? 'Checking' : 'Sign in'} onPress={verify} disabled={busy} />
      <Button label="Send a new code" variant="secondary" onPress={resend} />
      <Button label="Use a different email" variant="secondary" onPress={changeEmail} />
    </Screen>
  );
}
