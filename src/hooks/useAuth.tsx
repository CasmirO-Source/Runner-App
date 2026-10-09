import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profile, setProfileState] = useState<MyProfile | null>(null);
  const [profileState, setProfileStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
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

  const loadProfile = useCallback(async () => {
    setProfileStatus('loading');
    const result = await getMyProfile();
    if (result.ok) {
      setProfileState(result.data);
      setProfileStatus('loaded');
    } else {
      setProfileStatus('error');
    }
  }, []);

  useEffect(() => {
    setProfileState(null);
    if (userId) {
      loadProfile();
    } else {
      setProfileStatus('idle');
    }
  }, [userId, loadProfile]);

  const status: AuthStatus = !sessionLoaded
    ? 'loading'
    : !session
      ? 'signedOut'
      : profileState === 'error'
        ? 'error'
        : profileState !== 'loaded'
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
      setProfile: (p) => {
        setProfileState(p);
        setProfileStatus('loaded');
      },
      retry: loadProfile,
      // Ends this session on the server as well as on the phone, so a copied
      // token stops working straight away (Appendix A #25). Other devices
      // stay signed in.
      signOut: async () => {
        await supabase.auth.signOut({ scope: 'local' });
        setPendingEmail(null);
      },
    }),
    [status, session, profile, pendingEmail, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
