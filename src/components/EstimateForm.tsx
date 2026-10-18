import { useState } from 'react';

import { formatDuration, parseDuration } from '@/lib/runs';
import { fiveKInRange, parseWeeklyKm } from '@/lib/stride';
import type { StrideEstimate } from '@/types/profile';

import { Button } from './Button';
import { Text } from './Text';
import { TextField } from './TextField';
import { ToggleRow } from './ToggleRow';

type Props = {
  initial: StrideEstimate | null;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (estimate: StrideEstimate) => void;
};

// The two questions behind an estimated Stride (PRD 4.5): numbers people
// know, not labels. Checked here for quick feedback; the server decides.
export function EstimateForm({ initial, submitLabel, busy = false, error, onSubmit }: Props) {
  const [notSure, setNotSure] = useState(initial !== null && initial.five_k_s === null);
  const [fiveK, setFiveK] = useState(initial?.five_k_s ? formatDuration(initial.five_k_s) : '');
  const [weekly, setWeekly] = useState(initial ? String(initial.weekly_km) : '');
  const [errors, setErrors] = useState<{ fiveK?: string; weekly?: string }>({});

  function submit() {
    const seconds = notSure ? null : fiveKInRange(parseDuration(fiveK));
    const km = parseWeeklyKm(weekly);
    const next = {
      fiveK: notSure || seconds !== null ? undefined : 'Enter a time from 13:00 to 1:30:00, for example 27:30.',
      weekly: km !== null ? undefined : 'Enter whole kilometres from 0 to 150.',
    };
    setErrors(next);
    if (next.fiveK || next.weekly || km === null) return;
    onSubmit({ five_k_s: seconds, weekly_km: km });
  }

  return (
    <>
      {notSure ? null : (
        <TextField
          label="Your recent 5 km time"
          hint="A parkrun or any 5 km in the last few months."
          value={fiveK}
          onChangeText={setFiveK}
          placeholder="27:30"
          keyboardType="numbers-and-punctuation"
          maxLength={7}
          error={errors.fiveK}
        />
      )}
      <ToggleRow label="Not sure, or new to running" value={notSure} onChange={setNotSure} />
      <TextField
        label="How far you run in a typical week (km)"
        value={weekly}
        onChangeText={setWeekly}
        placeholder="15"
        keyboardType="number-pad"
        maxLength={3}
        error={errors.weekly}
      />
      {error ? (
        <Text variant="caption" colour="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label={busy ? 'Saving' : submitLabel} onPress={submit} disabled={busy} />
    </>
  );
}
