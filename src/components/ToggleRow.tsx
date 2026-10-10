import { StyleSheet, Switch, View } from 'react-native';

import { space } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

import { Text } from './Text';

type Props = {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
};

// An on/off setting, using the phone's own switch in the app's colours.
export function ToggleRow({ label, description, value, onChange }: Props) {
  const c = useColours();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text variant="bodyStrong">{label}</Text>
        {description ? (
          <Text variant="caption" colour="textSecondary">
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: c.inputBorder, true: c.accent }}
        thumbColor={c.background}
        ios_backgroundColor={c.inputBorder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  text: {
    flex: 1,
    gap: space.xs,
  },
});
