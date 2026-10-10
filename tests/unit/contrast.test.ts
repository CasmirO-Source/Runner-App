// Appendix B #7: every text and background pair meets WCAG AA in both modes.
// Body text needs at least 4.5 to 1. Input borders (non-text UI) need 3 to 1.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colours, type ColourScheme } from '../../src/theme/tokens.ts';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Key = Exclude<keyof ColourScheme, 'avatarTones'>;

const textOn: [Key, Key][] = [];
for (const bg of ['background', 'surface', 'surfacePressed'] as const) {
  for (const fg of ['textPrimary', 'textSecondary', 'accentText', 'up', 'down', 'danger'] as const) {
    textOn.push([fg, bg]);
  }
}
textOn.push(['onAccent', 'accent'], ['onAccent', 'accentPressed']);

for (const mode of ['light', 'dark'] as const) {
  const c = colours[mode];

  for (const [fg, bg] of textOn) {
    test(`${mode}: ${fg} on ${bg} is at least 4.5 to 1`, () => {
      const ratio = contrast(c[fg], c[bg]);
      assert.ok(ratio >= 4.5, `${ratio.toFixed(2)} to 1`);
    });
  }

  test(`${mode}: input border is at least 3 to 1 against the background`, () => {
    const ratio = contrast(c.inputBorder, c.background);
    assert.ok(ratio >= 3, `${ratio.toFixed(2)} to 1`);
  });

  test(`${mode}: every avatar tone is at least 3 to 1 against the background`, () => {
    for (const tone of c.avatarTones) {
      assert.ok(contrast(tone, c.background) >= 3, `${tone}: ${contrast(tone, c.background).toFixed(2)} to 1`);
    }
  });

  test(`${mode}: every colour is a plain six-digit hex value (no transparency or gradients)`, () => {
    for (const [key, value] of Object.entries(c)) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) assert.match(v, /^#[0-9A-F]{6}$/, key);
    }
  });
}
