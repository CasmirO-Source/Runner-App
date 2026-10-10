import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { AppError } from '@/api/errors';
import type { Result } from '@/api/profile';

type State<T> = { data: T | null; error: AppError | null; loading: boolean };

// Loads data when a screen comes into view, and again each time the user
// returns to it (so a league joined on another screen shows straight away).
// A late answer from a screen that has gone away is ignored.
export function useLoad<T>(load: () => Promise<Result<T>>): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load().then((result) => {
        if (!active) return;
        setState(result.ok ? { data: result.data, error: null, loading: false } : { data: null, error: result.error, loading: false });
      });
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt]),
  );

  return { ...state, reload: () => setAttempt((n) => n + 1) };
}
