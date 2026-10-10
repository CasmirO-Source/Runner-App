import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getMyProfile } from '@/api/profile';
import { supabase } from '@/lib/supabase';
import type { MyProfile } from '@/types/profile';

// Where the user is in the sign-in journey. The navigator only shows the
// screens allowed for the current status.
//   loading       working it out
//   signedOut     sign-in screens only
//   needsProfile  signed in, onboarding screens only
//   ready         signed in with a profile, the app itself
//   error         could not load the profile (offline); offer a retry
export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'ready' | 'error';

type AuthState = {
  status: AuthStatus;
  session: Session | null;
  profile: MyProfile | null;
  // The email a code was just sent to. Held in memory only, never put in a
  // route or URL (PRD privacy rules).
  pendingEmail: string | null;
  setPendingEmail: (email: string | null) => void;
  setProfile: (profile: MyProfile) => void;
  retry: () => void;
  signOut: () => Promise<void>;
};

type ProfileEntry = { userId: string; state: 'loading' | 'loaded' | 'error'; profile: MyProfile | null };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  // The loaded profile is stored together with the user it belongs to, so a
  // profile can never be shown for a different user after a switch.
  const [entry, setEntry] = useState<ProfileEntry | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    // Supabase advises doing no other Supabase calls inside this callback, so
    // it only records the session; the profile is loaded by the effect below.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionLoaded(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  // Bumped by "Try again" to load the profile once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    // If the user changes (or the screen goes away) before the answer comes
    // back, the late answer is thrown away rather than shown for the wrong
    // person.
    let cancelled = false;
    getMyProfile().then((result) => {
      if (cancelled) return;
      setEntry(
        result.ok
          ? { userId, state: 'loaded', profile: result.data }
          : { userId, state: 'error', profile: null },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  // Anything loaded for a different user is ignored until this user's
  // profile arrives.
  const current = entry && entry.userId === userId ? entry : null;
  const profile = current?.profile ?? null;

  const status: AuthStatus = !sessionLoaded
    ? 'loading'
    : !session
      ? 'signedOut'
      : current?.state === 'error'
        ? 'error'
        : current?.state !== 'loaded'
          ? 'loading'
          : profile
            ? 'ready'
            : 'needsProfile';

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      profile,
      pendingEmail,
      setPendingEmail,
      setProfile: (p) => setEntry({ userId: p.id, state: 'loaded', profile: p }),
      retry: () => {
        if (!userId) return;
        setEntry({ userId, state: 'loading', profile: null });
        setAttempt((n) => n + 1);
      },
      // Ends this session on the server as well as on the phone, so a copied
      // token stops working straight away (Appendix A #25). Other devices
      // stay signed in.
      signOut: async () => {
        await supabase.auth.signOut({ scope: 'local' });
        setPendingEmail(null);
      },
    }),
    [status, session, profile, pendingEmail, userId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
