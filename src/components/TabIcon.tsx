import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';

type Props = {
  ios: SFSymbol;
  android: AndroidSymbol;
  color: ColorValue;
  size: number;
};

// The platform's own icon set, as PRD 13.1 asks: SF Symbols on iPhone,
// Material Symbols on Android.
export function TabIcon({ ios, android, color, size }: Props) {
  return <SymbolView name={{ ios, android, web: android }} tintColor={color} size={size} />;
}
