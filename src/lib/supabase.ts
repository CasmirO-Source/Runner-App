import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { supabaseConfig } from './env';
import { secureStorage } from './secureStorage';

// The one Supabase client used by the whole app. It only ever holds the public
// anon key, so everything it can do is limited by row-level security and by
// the grants in our migrations.
export const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Sign-in uses a typed one-time code, never a link opened in the app, so
    // the client must not try to read login tokens from incoming URLs.
    detectSessionInUrl: false,
  },
});

// Only refresh tokens while the app is in the foreground. This follows
// Supabase's guidance for mobile apps and avoids refresh attempts the
// operating system would cut off in the background.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
