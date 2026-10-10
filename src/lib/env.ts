import { validateSupabaseConfig } from './envGuard';

// Expo only copies EXPO_PUBLIC_ variables into the app, and only when they are
// written out in full like this. Nothing else from .env can reach the bundle.
export const supabaseConfig = validateSupabaseConfig(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  __DEV__,
);
