// Linting with Expo's recommended rules (https://docs.expo.dev/guides/using-eslint/).
// Edge Functions run on Deno and are checked with `deno check` instead.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'supabase/functions/*'],
  },
  {
    // This rule protects how the app reads EXPO_PUBLIC_ variables at build
    // time. Tests run in Node and read their own environment, so it does not
    // apply there.
    files: ['tests/**'],
    rules: { 'expo/no-dynamic-env-var': 'off' },
  },
]);
