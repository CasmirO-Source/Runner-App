import { Redirect, useLocalSearchParams } from 'expo-router';

import { looksLikeCode, normaliseCode } from '@/lib/leagues';

// Opened from an invite link (runnerapp://join/CODE). It only fills in the
// code on the join screen: joining always takes a tap, so a link alone can
// never add anyone to a league. Anything that is not a valid-looking code is
// dropped.
export default function JoinLink() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const valid = typeof code === 'string' && looksLikeCode(code);
  return <Redirect href={valid ? { pathname: '/league/join', params: { code: normaliseCode(code) } } : '/league/join'} />;
}
