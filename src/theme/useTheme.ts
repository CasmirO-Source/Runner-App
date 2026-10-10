import { useColorScheme } from 'react-native';

import { colours, type ColourScheme } from './tokens';

// Returns the colour set for the phone's current light or dark mode.
export function useColours(): ColourScheme {
  return useColorScheme() === 'dark' ? colours.dark : colours.light;
}
