// Runs the integration tests against the local Supabase stack.
//   1. Reads the local stack's URLs and keys from `supabase status` into the
//      test process's environment. They are never printed or written to disk.
//   2. Starts its own Edge Function server (replacing the one the local stack
//      runs by default), waits until it is serving, and stops it at the end.
//      Pass --reuse-server to use a server that is already running instead
//      (for example while you test the app on a phone); the screenshot tests
//      are then skipped, because that server has no fake Claude address.
//   3. Runs tests/integration one file at a time.
//   4. The screenshot reader never calls the real Claude API in tests. A
//      function server started here gets a made-up key and the address of a
//      fake Claude server that the screenshot tests run on this machine
//      (FAKE_CLAUDE_PORT). The functions accept that address only on the local
//      stack.
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
const args = process.argv.slice(2);
const reuse = args.includes('--reuse-server');
let server = null;
let envDir = null;
let serving = Promise.resolve();
if (reuse) {
  console.log('Reusing the running Edge Function server. Screenshot tests will be skipped.');
} else {
  // Placeholder values only, in a throwaway folder outside the repository.
  envDir = mkdtempSync(join(tmpdir(), 'runner-functions-'));
  const envFile = join(envDir, 'functions.env');
  writeFileSync(
    envFile,
    `ANTHROPIC_API_KEY=local-test-key-not-real\nSCREENSHOT_READER_TEST_URL=http://host.docker.internal:${FAKE_CLAUDE_PORT}\n`,
  );
  testEnv.FAKE_CLAUDE_PORT = FAKE_CLAUDE_PORT;
  server = spawn('npx', ['supabase', 'functions', 'serve', '--env-file', envFile], {
    env: testEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  // The stack may already be serving functions without the test settings, so
  // answering requests is not enough: wait until this server says it is up.
  serving = new Promise((resolve, reject) => {
    let seen = '';
    const watch = (chunk) => {
      seen = (seen + chunk.toString()).slice(-4096);
      if (seen.includes('Serving functions on')) resolve();
    };
    server.stdout.on('data', watch);
    server.stderr.on('data', watch);
    server.on('exit', () => reject(new Error('The Edge Function server stopped while starting.')));
  });
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
  await Promise.race([
    serving,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Edge Functions did not start within 3 minutes.')), 180_000)),
  ]);
  await waitForFunctions();
  // A file pattern rather than a folder: Node 24 (used in CI) does not accept a
  // folder here, Node 26 does.
  const named = args.filter((a) => a !== '--reuse-server');
  const files = named.length ? named : ['tests/integration/**/*.test.ts'];
  const run = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], { env: testEnv, stdio: 'inherit' });
  code = await new Promise((resolve) => run.on('exit', (c) => resolve(c ?? 1)));
} catch (error) {
  console.error(error.message);
} finally {
  stopServer();
}
process.exit(code);
