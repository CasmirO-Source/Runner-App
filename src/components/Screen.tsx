import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

// Page wrapper: solid background, safe area, standard padding, and room for
// the keyboard. Content appears immediately (no fade-in, Appendix B #12).
export function Screen({ children }: { children: ReactNode }) {
  const c = useColours();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: space.xl,
    gap: space.xl,
  },
});
