import { Stack } from 'expo-router';

import { useColours } from '@/theme/useTheme';

export default function LeagueLayout() {
  const c = useColours();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }} />;
}
