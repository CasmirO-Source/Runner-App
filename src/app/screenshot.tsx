import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { confirmReading, readScreenshot } from '@/api/runs';
import { Button } from '@/components/Button';
import { DayPicker } from '@/components/DayPicker';
import { LinkButton } from '@/components/LinkButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import {
  dateLabel,
  dayIndex,
  dayOptions,
  formatDuration,
  formatKm,
  formatPace,
  parseClock,
  parseDistanceKm,
  parseDuration,
  reasonText,
  startTime,
  ukInstant,
} from '@/lib/runs';
import { pickScreenshot } from '@/lib/screenshot';
import { space } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';
import type { ConfirmResult, Reading } from '@/types/run';

type Step =
  | { kind: 'choose' }
  | { kind: 'reading' }
  | { kind: 'failed'; message: string }
  | { kind: 'confirm'; reading: Reading }
  | { kind: 'edit'; reading: Reading }
  | { kind: 'done'; result: ConfirmResult; metres: number };

type FieldErrors = { clock?: string; distance?: string; duration?: string; form?: string };

const withRef = (e: { message: string; ref?: string }) => (e.ref ? `${e.message} (ref ${e.ref})` : e.message);
const km2 = (metres: number) => `${(metres / 1000).toFixed(2)} km`;
const kmField = (metres: number) => String(Number((metres / 1000).toFixed(3)));

// Read a run from a screenshot (PRD 6.3, 13.3 screen 6). One step on screen
// at a time: choose, read, check, then saved. Nothing is saved until the
// runner presses Save. If they change anything, the server saves it as a
// typed-in run instead.
export default function ScreenshotScreen() {
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [days] = useState(() => dayOptions());
  const [day, setDay] = useState(0);
  const [clock, setClock] = useState('');
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function choose() {
    let prepared;
    try {
      prepared = await pickScreenshot();
    } catch {
      setStep({ kind: 'failed', message: "We couldn't open that image. Try another screenshot, or type the run in." });
      return;
    }
    if ('cancelled' in prepared) return;
    setStep({ kind: 'reading' });
    const result = await readScreenshot(prepared.base64);
    if (!result.ok) {
      setStep({ kind: 'failed', message: withRef(result.error) });
      return;
    }
    setClock(result.data.start_time ?? '');
    setErrors({});
    setStep({ kind: 'confirm', reading: result.data });
  }

  function startEditing(reading: Reading) {
    const index = dayIndex(days, reading.date);
    setDay(index >= 0 ? index : 0);
    setDistance(kmField(reading.distance_m));
    setDuration(formatDuration(reading.duration_s));
    setErrors({});
    setStep({ kind: 'edit', reading });
  }

  async function save(reading: Reading, values: { started_at: string; distance_m: number; duration_s: number }) {
    setBusy(true);
    setErrors({});
    const result = await confirmReading({ reading_id: reading.id, ...values });
    setBusy(false);
    if (!result.ok) {
      setErrors({ form: withRef(result.error) });
      return;
    }
    setStep({ kind: 'done', result: result.data, metres: values.distance_m });
  }

  function saveAsRead(reading: Reading) {
    const at = parseClock(reading.start_time ?? clock);
    if (!at) {
      setErrors({ clock: 'Add the time you started, on the 24-hour clock, for example 07:30.' });
      return;
    }
    void save(reading, { started_at: ukInstant(reading.date, at), distance_m: reading.distance_m, duration_s: reading.duration_s });
  }

  function saveEdited(reading: Reading) {
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
    void save(reading, { started_at: startTime(days[day].date, at), distance_m: metres, duration_s: seconds });
  }

  return (
    <Screen>
      <LinkButton label="Back" onPress={() => router.back()} />

      {step.kind === 'choose' ? (
        <>
          <Text variant="title">Read a screenshot</Text>
          <Text colour="textSecondary">
            Pick a screenshot of a finished run from any running app. We read the distance, time and date, and you check them before
            anything is saved.
          </Text>
          <Text variant="caption" colour="textSecondary">
            The screenshot is read once and then deleted. Screenshot runs count in friend leagues, not in verified-only leagues.
          </Text>
          <Button label="Choose a screenshot" onPress={choose} />
        </>
      ) : null}

      {step.kind === 'reading' ? <ReadingProgress /> : null}

      {step.kind === 'failed' ? (
        <>
          <Text variant="title">{"Couldn't read that"}</Text>
          <Text accessibilityRole="alert">{step.message}</Text>
          <Button label="Type it in" onPress={() => router.navigate('/run')} />
          <Button label="Try another screenshot" variant="secondary" onPress={() => setStep({ kind: 'choose' })} />
        </>
      ) : null}

      {step.kind === 'confirm' ? (
        <>
          <Text variant="title">Check your run</Text>
          {step.reading.source_app ? <Text colour="textSecondary">{`Read from ${step.reading.source_app}`}</Text> : null}
          <Figures reading={step.reading} />
          {dayIndex(days, step.reading.date) < 0 ? (
            <Text colour="danger">{"This run is more than 7 days old, so it won't count."}</Text>
          ) : null}
          {step.reading.start_time === null ? (
            <TextField
              label="Start time"
              hint="The screenshot doesn't show when you started."
              value={clock}
              onChangeText={setClock}
              placeholder="07:30"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              error={errors.clock}
            />
          ) : null}
          <FormError text={errors.form} />
          <Button label={busy ? 'Saving' : 'Save run'} onPress={() => saveAsRead(step.reading)} disabled={busy} />
          <Button label="Wrong? Type it in" variant="secondary" onPress={() => startEditing(step.reading)} disabled={busy} />
        </>
      ) : null}

      {step.kind === 'edit' ? (
        <>
          <Text variant="title">Fix the details</Text>
          <Text colour="textSecondary">Changed runs are saved as typed-in runs.</Text>
          <View style={styles.group}>
            <Text variant="label">Day</Text>
            <DayPicker options={days} selected={day} onSelect={setDay} />
          </View>
          <TextField label="Start time" value={clock} onChangeText={setClock} placeholder="07:30" keyboardType="numbers-and-punctuation" maxLength={5} error={errors.clock} />
          <TextField label="Distance (km)" value={distance} onChangeText={setDistance} placeholder="5.2" keyboardType="decimal-pad" maxLength={7} error={errors.distance} />
          <TextField label="Time" value={duration} onChangeText={setDuration} placeholder="25:30" keyboardType="numbers-and-punctuation" maxLength={8} error={errors.duration} />
          <FormError text={errors.form} />
          <Button label={busy ? 'Saving' : 'Save run'} onPress={() => saveEdited(step.reading)} disabled={busy} />
        </>
      ) : null}

      {step.kind === 'done' ? <Saved result={step.result} metres={step.metres} /> : null}
    </Screen>
  );
}

function ReadingProgress() {
  const c = useColours();
  return (
    <View style={styles.group} accessibilityLiveRegion="polite">
      <Text variant="title">Reading your screenshot</Text>
      <ActivityIndicator color={c.accent} />
      <Text colour="textSecondary">This usually takes a few seconds.</Text>
    </View>
  );
}

function Figures({ reading }: { reading: Reading }) {
  const rows: [string, string][] = [
    ['Distance', km2(reading.distance_m)],
    ['Time', formatDuration(reading.duration_s)],
    ['Pace', formatPace(reading.distance_m, reading.duration_s)],
    ['Date', dateLabel(reading.date)],
    ...(reading.start_time ? ([['Started', reading.start_time]] as [string, string][]) : []),
  ];
  return (
    <View style={styles.group}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text variant="label" colour="textSecondary">
            {label}
          </Text>
          <Text variant="heading" tabular>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function FormError({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <Text variant="caption" colour="danger" accessibilityRole="alert">
      {text}
    </Text>
  );
}

function Saved({ result, metres }: { result: ConfirmResult; metres: number }) {
  return (
    <View style={styles.group} accessibilityLiveRegion="polite">
      {result.status === 'accepted' ? (
        <Text variant="title">{`Logged. ${formatKm(metres)} added.`}</Text>
      ) : (
        <>
          <Text variant="title">{"Saved, but it won't count"}</Text>
          {result.reasons.map((r) => (
            <Text key={r} colour="textSecondary">
              {reasonText(r)}
            </Text>
          ))}
        </>
      )}
      <Text variant="caption" colour="textSecondary">
        {result.saved_as === 'screenshot'
          ? 'Saved as a screenshot run.'
          : 'Saved as a typed-in run, because the details were changed.'}
      </Text>
      <Button label="See your runs" onPress={() => router.navigate('/activity')} />
      <Button label="Done" variant="secondary" onPress={() => router.navigate('/run')} />
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: space.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
});
