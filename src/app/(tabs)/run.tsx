import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { logManualRun } from '@/api/runs';
import { Button } from '@/components/Button';
import { DayPicker } from '@/components/DayPicker';
import { LinkButton } from '@/components/LinkButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { dayOptions, formatKm, parseClock, parseDistanceKm, parseDuration, reasonText, startTime } from '@/lib/runs';
import { space } from '@/theme/tokens';

type Outcome = { kind: 'accepted'; metres: number } | { kind: 'flagged'; reasons: string[] };

// Run tab (centre): log a run. Manual entry for now; syncing from Apple
// Health and Health Connect, and screenshots (milestone 4), join here later.
export default function RunTab() {
  const [days] = useState(() => dayOptions());
  const [day, setDay] = useState(0);
  const [clock, setClock] = useState('');
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const [errors, setErrors] = useState<{ clock?: string; distance?: string; duration?: string; form?: string }>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const at = parseClock(clock);
    const metres = parseDistanceKm(distance);
    const seconds = parseDuration(duration);
    const next = {
      clock: at ? undefined : 'Use the 24-hour clock, for example 07:30.',
      distance: metres ? undefined : 'Enter kilometres, for example 5.2.',
      duration: seconds ? undefined : 'Enter minutes and seconds (25:30) or hours too (1:05:30).',
    };
    setErrors(next);
    if (!at || !metres || !seconds) return;

    setBusy(true);
    setOutcome(null);
    const result = await logManualRun({ started_at: startTime(days[day].date, at), distance_m: metres, duration_s: seconds });
    setBusy(false);
    if (!result.ok) {
      setErrors({ form: result.error.ref ? `${result.error.message} (ref ${result.error.ref})` : result.error.message });
      return;
    }
    setOutcome(result.data.status === 'accepted' ? { kind: 'accepted', metres } : { kind: 'flagged', reasons: result.data.reasons });
    setClock('');
    setDistance('');
    setDuration('');
  }

  return (
    <Screen>
      <Text variant="title">Log a run</Text>
      <Text colour="textSecondary">Typed-in runs count in friend leagues, but not in verified-only leagues.</Text>

      <View style={styles.field}>
        <Text variant="label">Day</Text>
        <DayPicker options={days} selected={day} onSelect={setDay} />
      </View>
      <TextField label="Start time" value={clock} onChangeText={setClock} placeholder="07:30" keyboardType="numbers-and-punctuation" maxLength={5} error={errors.clock} />
      <TextField label="Distance (km)" value={distance} onChangeText={setDistance} placeholder="5.2" keyboardType="decimal-pad" maxLength={7} error={errors.distance} />
      <TextField label="Time" value={duration} onChangeText={setDuration} placeholder="25:30" keyboardType="numbers-and-punctuation" maxLength={8} error={errors.duration} />

      {errors.form ? (
        <Text variant="caption" colour="danger" accessibilityRole="alert">
          {errors.form}
        </Text>
      ) : null}

      <Button label={busy ? 'Saving' : 'Save run'} onPress={save} disabled={busy} />

      {outcome?.kind === 'accepted' ? (
        <View style={styles.field} accessibilityLiveRegion="polite">
          <Text variant="heading">{`Logged. ${formatKm(outcome.metres)} added.`}</Text>
          <LinkButton label="See your runs" onPress={() => router.navigate('/activity')} />
        </View>
      ) : null}
      {outcome?.kind === 'flagged' ? (
        <View style={styles.field} accessibilityLiveRegion="polite">
          <Text variant="heading">{"Saved, but it won't count"}</Text>
          {outcome.reasons.map((r) => (
            <Text key={r} colour="textSecondary">
              {reasonText(r)}
            </Text>
          ))}
          <Text variant="caption" colour="textSecondary">
            Flagged runs are checked by a person. If it is a mistake, log the run again with the right details.
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: space.sm,
  },
});
