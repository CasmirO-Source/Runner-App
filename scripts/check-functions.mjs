// Type-checks every Edge Function with Deno, the runtime Supabase uses for
// them. Each function folder has its own deno.json with pinned versions.
// Fails if any function has a type error.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = 'supabase/functions';
const functions = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(root, d.name, 'index.ts')))
  .map((d) => d.name);

for (const name of functions) {
  console.log(`deno check ${name}`);
  execFileSync('deno', ['check', 'index.ts'], { cwd: join(root, name), stdio: 'inherit' });
}
console.log(`Checked ${functions.length} Edge Function(s).`);
