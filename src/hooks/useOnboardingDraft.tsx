import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { StrideEstimate } from '@/types/profile';

// Onboarding answers, kept in memory until the last step sends them. Only the
// "over 18" result is kept from the age step; the date of birth itself never
// leaves that screen.
type Draft = {
  over18: boolean;
  displayName: string;
  // A name problem reported by the server, shown when the user is sent back.
  nameError: string | null;
  // The optional estimated Stride answers (PRD 4.5), or null if skipped.
  estimate: StrideEstimate | null;
  setOver18: (v: boolean) => void;
  setEstimate: (v: StrideEstimate | null) => void;
  setDisplayName: (v: string) => void;
  setNameError: (v: string | null) => void;
};

const DraftContext = createContext<Draft | null>(null);

export function OnboardingDraftProvider({ children }: { children: ReactNode }) {
  const [over18, setOver18] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<StrideEstimate | null>(null);
  const value = useMemo(
    () => ({ over18, displayName, nameError, estimate, setOver18, setDisplayName, setNameError, setEstimate }),
    [over18, displayName, nameError, estimate],
  );
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useOnboardingDraft(): Draft {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error('useOnboardingDraft must be used inside onboarding');
  return ctx;
}
