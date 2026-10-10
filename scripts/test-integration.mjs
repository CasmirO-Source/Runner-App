// Runs the integration tests against the local Supabase stack.
//   1. Reads the local stack's URLs and keys from `supabase status` into the
//      test process's environment. They are never printed or written to disk.
//   2. Uses the Edge Function server if one is already running (for example
//      while you test the app on a phone). Otherwise starts one, waits until it
//      answers, and stops it again at the end.
//   3. Runs tests/integration one file at a time.
//   4. The screenshot reader never calls the real Claude API in tests. A
//      function server started here gets a made-up key and the address of a
//      fake Claude server that the screenshot tests run on this machine
//      (FAKE_CLAUDE_PORT). The functions accept that address only on the local
//      stack. A server that was already running has neither, so the
//      screenshot tests are skipped, with a note.
// Refuses to run unless the API is on this machine.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const PATH = `${homedir()}/.docker/bin:${process.env.PATH}`;

function stackEnv() {
  let out;
  try {
    out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH } });
  } catch {
    console.error('The local Supabase stack is not running. Start it with: npx supabase start');
    process.exit(1);
  }
  const vars = {};
  for (const line of out.split('\n')) {
    const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

const vars = stackEnv();
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(vars.API_URL ?? '')) {
  console.error('Refusing to run: API_URL is not the local stack.');
  process.exit(1);
}
const testEnv = {
  ...process.env,
  PATH,
  API_URL: vars.API_URL,
  PUBLISHABLE_KEY: vars.PUBLISHABLE_KEY,
  SERVICE_ROLE_KEY: vars.SERVICE_ROLE_KEY,
  MAILPIT_URL: vars.MAILPIT_URL ?? vars.INBUCKET_URL,
};

// The profile function answers 401 to a request with no login token, which
// shows a function server is running behind the gateway.
async function functionsUp() {
  try {
    const r = await fetch(`${vars.API_URL}/functions/v1/profile`, { method: 'POST', headers: { apikey: vars.PUBLISHABLE_KEY } });
    return r.status === 401;
  } catch {
    return false;
  }
}

async function waitForFunctions() {
  // Creating the edge runtime container from scratch can take over a minute.
  for (let i = 0; i < 180; i++) {
    if (await functionsUp()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Edge Functions did not start within 3 minutes.');
}

const FAKE_CLAUDE_PORT = '54398';
let server = null;
let envDir = null;
if (await functionsUp()) {
  console.log('Using the Edge Function server that is already running. Screenshot tests need a server started by this script, so they will be skipped.');
} else {
  // Placeholder values only, in a throwaway folder outside the repository.
  envDir = mkdtempSync(join(tmpdir(), 'runner-functions-'));
  const envFile = join(envDir, 'functions.env');
  writeFileSync(
    envFile,
    `ANTHROPIC_API_KEY=local-test-key-not-real\nSCREENSHOT_READER_TEST_URL=http://host.docker.internal:${FAKE_CLAUDE_PORT}\n`,
  );
  testEnv.FAKE_CLAUDE_PORT = FAKE_CLAUDE_PORT;
  server = spawn('npx', ['supabase', 'functions', 'serve', '--env-file', envFile], { env: testEnv, stdio: 'ignore', detached: true });
}
const stopServer = () => {
  if (envDir) rmSync(envDir, { recursive: true, force: true });
  if (!server) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // Already stopped.
  }
};

let code = 1;
try {
  await waitForFunctions();
  // A file pattern rather than a folder: Node 24 (used in CI) does not accept a
  // folder here, Node 26 does.
  const files = process.argv.slice(2).length ? process.argv.slice(2) : ['tests/integration/**/*.test.ts'];
  const run = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], { env: testEnv, stdio: 'inherit' });
  code = await new Promise((resolve) => run.on('exit', (c) => resolve(c ?? 1)));
} catch (error) {
  console.error(error.message);
} finally {
  stopServer();
}
process.exit(code);
