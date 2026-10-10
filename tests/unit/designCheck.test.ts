// Proves the design check really catches each banned item, and does not flag
// comments that only mention them.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkText } from '../../scripts/design-check.mjs';

const EM = String.fromCharCode(0x2014);
const flags = (file: string, line: string) => (checkText(file, line) as string[]).length > 0;

test('em dashes are caught in every kind of file, comments included', () => {
  for (const file of ['src/app/x.tsx', 'docs/notes.md', 'supabase/migrations/1.sql', 'CLAUDE.md']) {
    assert.ok(flags(file, `Fast ${EM} really fast`), file);
    assert.ok(flags(file, `// a comment ${EM} with a dash`), `${file} comment`);
  }
  assert.ok(!flags('src/app/x.tsx', 'Fast, really fast'));
});

test('banned styles, fonts and icons are caught in app code', () => {
  const banned = [
    "import { LinearGradient } from 'expo-linear-gradient';",
    "background: 'linear-gradient(90deg, red, blue)'",
    "import { BlurView } from 'expo-blur';",
    "style={{ backdropFilter: 'blur(10px)' }}",
    "fontFamily: 'Inter'",
    "import { Inter_400Regular } from '@expo-google-fonts/inter';",
    "import { Heart } from 'lucide-react-native';",
    "fontFamily: 'SpaceGrotesk-Bold'",
    "fontFamily: 'Space Grotesk'",
    "fontFamily: 'InstrumentSerif-Italic'",
    "fontStyle: 'italic'",
    "fontFamily: 'Georgia, serif'",
    '<Button label="Go \u{1F680}" />',
  ];
  for (const line of banned) assert.ok(flags('src/app/x.tsx', line), line);
});

test('banned styles are caught in email templates', () => {
  assert.ok(flags('supabase/templates/x.html', '<div style="background: linear-gradient(red, blue)">'));
  assert.ok(flags('supabase/templates/x.html', '<p style="font-family: Inter, sans-serif">'));
});

test('raw colours and spacing are caught outside the tokens file', () => {
  assert.ok(flags('src/components/X.tsx', "color: '#ff0000',"));
  assert.ok(flags('src/components/X.tsx', "backgroundColor: 'rgba(0,0,0,0.5)',"));
  assert.ok(flags('src/components/X.tsx', 'padding: 13,'));
  assert.ok(flags('src/components/X.tsx', 'marginHorizontal: 20,'));
  assert.ok(flags('src/components/X.tsx', '<TouchableOpacity activeOpacity={0.5}>'));
  assert.ok(!flags('src/theme/tokens.ts', "accent: '#FF5A1F',"), 'tokens file may define colours');
  assert.ok(!flags('src/components/X.tsx', 'padding: space.lg,'));
});

test('comments explaining a rule, and onBlur, are not flagged', () => {
  assert.ok(!flags('src/theme/tokens.ts', '// No gradients anywhere.'));
  assert.ok(!flags('src/app/_layout.tsx', '  // files rather than eighteen. Italics are never loaded'));
  assert.ok(!flags('src/components/TextField.tsx', '        onBlur={() => setFocused(false)}'));
});
