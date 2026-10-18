import { StyleSheet, View } from 'react-native';

import { strideView, type StrideFields } from '@/lib/stride';
import { space } from '@/theme/tokens';

import { Text } from './Text';

type Props = { fields: StrideFields; compact?: boolean };

// A runner's Stride: the number in the display font with the tier beside it
// (PRD 13.1: numbers first). Before placement, the estimate (always marked
// "est.") or the placement progress (PRD 4.4, 4.5).
export function StrideSummary({ fields, compact = false }: Props) {
  const view = strideView(fields);

  if (view.kind === 'placing') {
    return (
      <View style={styles.group}>
        <Text variant="label" colour="textSecondary">Stride</Text>
        <Text variant="heading">{view.placing}</Text>
        {compact ? null : (
          <Text variant="caption" colour="textSecondary">
            Your Stride comes from 3 verified runs of 3 to 21.1 km, synced from Apple Health or Health Connect.
          </Text>
        )}
      </View>
    );
  }

  const estimate = view.kind === 'estimate';
  return (
    <View
      style={styles.group}
      accessible
      accessibilityLabel={`Stride ${estimate ? 'estimate ' : ''}${view.value}, ${view.tier}${estimate ? `, ${view.placing}` : ''}`}
    >
      <Text variant="label" colour="textSecondary">{estimate ? 'Stride, estimated' : 'Stride'}</Text>
      <View style={styles.figure}>
        <Text variant={compact ? 'title' : 'display'} tabular>
          {String(view.value)}
        </Text>
        <Text variant="heading" colour="accentText">
          {estimate ? `${view.tier} est.` : view.tier}
        </Text>
      </View>
      {estimate && !compact ? (
        <Text variant="caption" colour="textSecondary">
          {`From your answers. ${view.placing}: your real Stride replaces this after 3 verified runs.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: space.xs,
  },
  figure: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.md,
  },
});
