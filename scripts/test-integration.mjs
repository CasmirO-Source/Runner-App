// Runs the integration tests against the local Supabase stack.
//   1. Reads the local stack's URLs and keys from `supabase status` into the
//      test process's environment. They are never printed or written to disk.
//   2. Uses the Edge Function server if one is already running (for example
//      while you test the app on a phone). Otherwise starts one, waits until it
//      answers, and stops it again at the end.
//   3. Runs tests/integration one file at a time.
// Refuses to run unless the API is on this machine.
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';

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
  for (let i = 0; i < 60; i++) {
    if (await functionsUp()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Edge Functions did not start within 60 seconds.');
}

let server = null;
if (await functionsUp()) {
  console.log('Using the Edge Function server that is already running.');
} else {
  server = spawn('npx', ['supabase', 'functions', 'serve'], { env: testEnv, stdio: 'ignore', detached: true });
}
const stopServer = () => {
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
  const files = process.argv.slice(2).length ? process.argv.slice(2) : ['tests/integration/'];
  const run = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], { env: testEnv, stdio: 'inherit' });
  code = await new Promise((resolve) => run.on('exit', (c) => resolve(c ?? 1)));
} catch (error) {
  console.error(error.message);
} finally {
  stopServer();
}
process.exit(code);
