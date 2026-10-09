// The single source of every colour, font and spacing value in the app
// (PRD 13.1 and Appendix B). Screens and components may only use these tokens.
// The design check script in CI fails the build on raw colour values anywhere
// else.
//
// Pure module with no React Native imports, so the contrast test can run in Node.

// Colour
// One accent (signal orange) plus one colour each for up and down movement.
// No gradients anywhere. Every text and background pair is tested against
// WCAG AA in tests/unit/contrast.test.ts.

export type ColourScheme = {
  background: string;
  surface: string;
  surfacePressed: string;
  divider: string;
  inputBorder: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  accentText: string;
  up: string;
  down: string;
  danger: string;
  avatarTones: readonly [string, string, string];
};

export const colours: { light: ColourScheme; dark: ColourScheme } = {
  light: {
    background: '#F5F3EE',
    surface: '#E8E5DD',
    surfacePressed: '#D9D5CA',
    divider: '#D3CFC4',
    inputBorder: '#7A766C',
    textPrimary: '#121212',
    textSecondary: '#4D4A44',
    accent: '#FF5A1F',
    accentPressed: '#FF7C4D',
    onAccent: '#121212',
    accentText: '#A33208',
    up: '#0A6630',
    down: '#AE1F25',
    danger: '#B3121A',
    avatarTones: ['#D4450C', '#121212', '#7A766C'],
  },
  dark: {
    background: '#0E0E0F',
    surface: '#1B1B1D',
    surfacePressed: '#2A2A2D',
    divider: '#2E2E31',
    inputBorder: '#8A8780',
    textPrimary: '#F5F3EE',
    textSecondary: '#ADAAA3',
    accent: '#FF5A1F',
    accentPressed: '#FF7C4D',
    onAccent: '#0E0E0F',
    accentText: '#FF7038',
    up: '#3DD68C',
    down: '#FF6B6B',
    danger: '#FF7A7A',
    avatarTones: ['#FF5A1F', '#F5F3EE', '#8A8780'],
  },
};

// Spacing
// The strict 4-point scale. No other spacing values are allowed.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export type SpaceToken = keyof typeof space;

// Corner radius and sizes are taken from the same scale.
export const radius = {
  sm: space.xs,
  md: space.sm,
} as const;

// Smallest comfortable touch target.
export const minTouchSize = space.xxxl;

// Type
// Barlow Condensed for numbers and headings, the platform system font (SF Pro on
// iPhone, Roboto on Android) for body text. No serif fonts and no italics.

export const fontFamilies = {
  displayBold: 'BarlowCondensed_700Bold',
  displaySemiBold: 'BarlowCondensed_600SemiBold',
  // undefined means the platform system font.
  body: undefined,
} as const;

export type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'label' | 'caption';

type TypeStyle = {
  fontFamily: string | undefined;
  fontSize: number;
  lineHeight: number;
  fontWeight?: '400' | '600';
  letterSpacing?: number;
  textTransform?: 'uppercase';
};

export const typography: Record<TextVariant, TypeStyle> = {
  display: { fontFamily: fontFamilies.displayBold, fontSize: 56, lineHeight: 60 },
  title: { fontFamily: fontFamilies.displayBold, fontSize: 36, lineHeight: 40 },
  heading: { fontFamily: fontFamilies.displaySemiBold, fontSize: 24, lineHeight: 28 },
  body: { fontFamily: fontFamilies.body, fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontFamily: fontFamilies.body, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  caption: { fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 18, fontWeight: '400' },
};

// Motion
// Only where it carries meaning. The pressed state scales slightly.
export const pressedScale = 0.97;

// Line widths for input borders, dividers and the selected-avatar ring.
export const stroke = {
  thin: 1,
  thick: 2,
} as const;
