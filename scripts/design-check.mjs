// Design check (PRD 13.2, Appendix B enforcement). Fails the build if the
// code contains anything on the banned list that a script can spot.
//
// Two kinds of scan:
//   * Every text file in the repository (code, docs, config, emails): no em
//     dash (U+2014), anywhere, including comments (PRD section 0).
//   * App code, app config and email templates: banned styles, fonts and
//     icon sets, plus raw colours or spacing outside the design tokens file.
//     Comment lines are skipped here, so comments explaining a rule ("no
//     gradients") do not trip it.
//
// Usage: node scripts/design-check.mjs            (whole repository)
//        node scripts/design-check.mjs file ...   (just these files)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EM_DASH = new RegExp(String.fromCharCode(0x2014));
const TOKENS_FILE = 'src/theme/tokens.ts';
const SELF = 'scripts/design-check.mjs';

// Files where banned styles, fonts and icons are looked for.
const STYLE_SCOPE = /^(src\/|app\.json$|app\.config\.(js|ts)$|supabase\/templates\/)/;

export const RULES = [
  { id: 'gradient', message: 'Gradients are banned (Appendix B #1, #2, #20)', pattern: /linear-gradient|radial-gradient|conic-gradient|LinearGradient|RadialGradient|expo-linear-gradient|react-native-linear-gradient|\bgradient/i },
  { id: 'blur', message: 'Blur and glass effects are banned (Appendix B #6)', pattern: /BlurView|expo-blur|blurRadius|backdrop-?filter|glassmorph|filter:\s*blur|\bblur\(/i },
  { id: 'inter', message: 'The Inter font is banned (Appendix B #4)', pattern: /(['"`]Inter(\b|_)|@expo-google-fonts\/inter|font-family:[^;]*\bInter\b)/ },
  { id: 'lucide', message: 'Lucide icons are banned (Appendix B #10)', pattern: /lucide/i },
  { id: 'space-grotesk', message: 'Space Grotesk is banned (Appendix B #19)', pattern: /space[ _-]?grotesk/i },
  { id: 'instrument-serif', message: 'Instrument Serif is banned (Appendix B #19)', pattern: /instrument[ _-]?serif/i },
  { id: 'italic', message: 'Italic text is banned (Appendix B #18)', pattern: /fontStyle:\s*['"]italic|font-style:\s*italic|_Italic\b/ },
  { id: 'serif', message: 'Serif fonts are banned (Appendix B #18)', pattern: /fontFamily:\s*['"][^'"]*\bserif\b|font-family:[^;]*\bserif\b(?!-)/i },
  { id: 'emoji', message: 'Emojis are banned in the app (Appendix B #3)', pattern: /\p{Extended_Pictographic}/u },
];

// Only in app code: everything must come from the tokens file.
export const TOKEN_RULES = [
  { id: 'raw-colour', message: 'Use a colour token from src/theme/tokens.ts (Appendix B enforcement)', pattern: /#[0-9A-Fa-f]{3,8}\b|\brgba?\(|\bhsla?\(/ },
  { id: 'raw-spacing', message: 'Use a spacing token from src/theme/tokens.ts (Appendix B #15)', pattern: /\b(padding|margin|gap|rowGap|columnGap)(Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?\s*:\s*-?\d/ },
  { id: 'opacity-only-press', message: 'Pressed states must change colour or size, not only fade (Appendix B #14)', pattern: /TouchableOpacity|activeOpacity/ },
];

const isCommentLine = (line) => /^\s*(\/\/|\/\*|\*|<!--|#(?!\w))/.test(line);

export function checkText(file, text) {
  const problems = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    if (EM_DASH.test(line)) problems.push(`${where}  em dash found. Use a colon, comma or full stop instead (PRD section 0)`);
    if (file === SELF || !STYLE_SCOPE.test(file) || isCommentLine(line)) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) problems.push(`${where}  ${rule.message}`);
    }
    if (file.startsWith('src/') && file !== TOKENS_FILE) {
      for (const rule of TOKEN_RULES) {
        if (rule.pattern.test(line)) problems.push(`${where}  ${rule.message}`);
      }
    }
  });
  return problems;
}

function repositoryFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !/\.(png|jpe?g|gif|webp|ttf|otf|woff2?|ico|lock)$/i.test(f) && f !== 'package-lock.json');
}

function main(argv) {
  const files = argv.length ? argv : repositoryFiles();
  const problems = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    problems.push(...checkText(file, text));
  }
  if (problems.length) {
    console.error(`design-check FAILED (${problems.length}):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`design-check passed (${files.length} files).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
