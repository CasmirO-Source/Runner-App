import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { getMyProfile } from '@/api/profile';
import { useAuth } from '@/hooks/useAuth';

// Re-reads your profile each time a screen comes into view, so your Stride is
// current after a sync or a change made on another screen.
export function useFreshProfile() {
  const auth = useAuth();
  // setProfile changes whenever the profile does; reading it through a ref
  // stops a fresh profile from triggering another fetch.
  const setProfile = useRef(auth.setProfile);
  useEffect(() => {
    setProfile.current = auth.setProfile;
  }, [auth.setProfile]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getMyProfile().then((result) => {
        if (active && result.ok && result.data) setProfile.current(result.data);
      });
      return () => {
        active = false;
      };
    }, []),
  );
  return auth;
}
