import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/hooks/useAuth';
import { checkAge, todayParts } from '@/lib/age';
import { space } from '@/theme/tokens';

import { useOnboardingDraft } from '@/hooks/useOnboardingDraft';

// Step 1 of 3: the 18+ check (PRD 5.1, section 12). The date of birth stays
// on this screen: it is checked on the phone, then thrown away. Only "over 18:
// yes" is ever sent to the server.
export default function AgeCheck() {
  const { setOver18 } = useOnboardingDraft();
  const { signOut } = useAuth();
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tooYoung, setTooYoung] = useState(false);

  const digits = (t: string) => t.replace(/\D/g, '');

  function next() {
    const result = checkAge({ day: Number(day), month: Number(month), year: Number(year) }, todayParts());
    if (result === 'invalid') {
      setError('Check your date of birth.');
      return;
    }
    if (result === 'under18') {
      setTooYoung(true);
      return;
    }
    setOver18(true);
    router.push('/onboarding/name');
  }

  if (tooYoung) {
    return (
      <Screen>
        <Text variant="title">Sorry, not yet</Text>
        <Text colour="textSecondary">You need to be 18 or over to use Runner App.</Text>
        <Button label="Sign out" onPress={signOut} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="caption" colour="textSecondary">Step 1 of 3</Text>
      <Text variant="title">When were you born?</Text>
      <Text colour="textSecondary">Runner App is for over-18s. We check your date of birth on your phone and only keep a yes or no.</Text>
      <View style={styles.row}>
        <View style={styles.field}>
          <TextField label="Day" value={day} onChangeText={(t) => setDay(digits(t))} placeholder="DD" keyboardType="number-pad" maxLength={2} />
        </View>
        <View style={styles.field}>
          <TextField label="Month" value={month} onChangeText={(t) => setMonth(digits(t))} placeholder="MM" keyboardType="number-pad" maxLength={2} />
        </View>
        <View style={styles.field}>
          <TextField label="Year" value={year} onChangeText={(t) => setYear(digits(t))} placeholder="YYYY" keyboardType="number-pad" maxLength={4} />
        </View>
      </View>
      {error ? (
        <Text variant="caption" colour="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label="Next" onPress={next} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.md,
  },
  field: {
    flex: 1,
  },
});
