// Edge Function dependencies (supabase/functions/*/deno.json) are invisible to
// npm audit and Dependabot, which only read package.json. This script closes
// that gap (PRD 9.4 rule 15, Appendix A #37 and #38):
//   1. Every function must use the same @supabase/supabase-js version as the
//      app, so a Dependabot update to the app forces the functions to follow.
//   2. Every npm package the functions import is put through `npm audit` in a
//      throwaway folder, using the same exceptions file as the app.
//   3. Prints a notice when a newer version of a function-only package exists.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = 'supabase/functions';
const deps = new Map();
for (const d of readdirSync(root, { withFileTypes: true })) {
  const file = join(root, d.name, 'deno.json');
  if (!d.isDirectory() || !existsSync(file)) continue;
  const { imports = {} } = JSON.parse(readFileSync(file, 'utf8'));
  for (const spec of Object.values(imports)) {
    const m = /^npm:(@?[^@]+)@(.+)$/.exec(spec);
    if (!m) {
      console.error(`function-deps FAILED: ${file} imports "${spec}". Only exact npm: versions are allowed.`);
      process.exit(1);
    }
    const [, name, version] = m;
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      console.error(`function-deps FAILED: ${file} must pin an exact version of ${name}, not "${version}".`);
      process.exit(1);
    }
    const seen = deps.get(name);
    if (seen && seen !== version) {
      console.error(`function-deps FAILED: functions use different versions of ${name} (${seen} and ${version}).`);
      process.exit(1);
    }
    deps.set(name, version);
  }
}

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const appSupabase = lock.packages['node_modules/@supabase/supabase-js']?.version;
const fnSupabase = deps.get('@supabase/supabase-js');
if (fnSupabase && fnSupabase !== appSupabase) {
  console.error(`function-deps FAILED: functions use @supabase/supabase-js ${fnSupabase} but the app uses ${appSupabase}. Update every deno.json to ${appSupabase}.`);
  process.exit(1);
}

// Audit in a throwaway folder with only the function dependencies.
const dir = mkdtempSync(join(tmpdir(), 'function-deps-'));
try {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'function-deps', private: true, dependencies: Object.fromEntries(deps) }));
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'ignore' });
  execFileSync(process.execPath, [join(process.cwd(), 'scripts/audit-check.mjs'), '--dir', dir, '--allow-unused-exceptions'], { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

for (const [name, version] of deps) {
  if (name === '@supabase/supabase-js') continue;
  try {
    const latest = execFileSync('npm', ['view', name, 'version'], { encoding: 'utf8' }).trim();
    if (latest !== version) console.log(`notice: ${name} ${latest} is available (functions use ${version}).`);
  } catch {
    // Registry unreachable: the notice is informational only.
  }
}
console.log(`function-deps passed (${[...deps].map(([n, v]) => `${n}@${v}`).join(', ')}).`);
