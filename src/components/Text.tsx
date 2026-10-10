import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { typography, type ColourScheme, type TextVariant } from '@/theme/tokens';
import { useColours } from '@/theme/useTheme';

type TextColour = 'textPrimary' | 'textSecondary' | 'accentText' | 'up' | 'down' | 'danger' | 'onAccent';

type Props = Omit<RNTextProps, 'style'> & {
  variant?: TextVariant;
  colour?: TextColour;
  // Fixed-width digits so numbers line up in tables and do not jiggle as they change.
  tabular?: boolean;
  align?: 'left' | 'center';
};

// All text in the app goes through this component, so every string uses a
// token font, size and colour. User-supplied text is always rendered as plain
// text here, never as HTML or markup.
export function Text({ variant = 'body', colour = 'textPrimary', tabular, align, ...rest }: Props) {
  const c: ColourScheme = useColours();
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={1.6}
      style={[
        typography[variant],
        { color: c[colour], textAlign: align },
        tabular ? { fontVariant: ['tabular-nums'] } : null,
      ]}
    />
  );
}
