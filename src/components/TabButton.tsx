import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, type AccessibilityState, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';

import { pressedScale } from '@/theme/tokens';

type Props = {
  children: ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: ((e: GestureResponderEvent) => void) | null;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

// Tab bar button. Like every button in the app, a press changes its size and
// gives a light vibration (Appendix B #14); the active tab is shown by colour.
export function TabButton({ children, onPress, onLongPress, accessibilityLabel, accessibilityState, testID, style }: Props) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress ?? undefined}
      onPressIn={() => {
        Haptics.selectionAsync().catch(() => {});
      }}
      style={({ pressed }) => [style, { transform: [{ scale: pressed ? pressedScale : 1 }] }]}
    >
      {children}
    </Pressable>
  );
}
