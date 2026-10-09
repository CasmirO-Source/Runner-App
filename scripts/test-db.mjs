// Runs the pgTAP database tests (supabase/tests/database) against the local
// stack. Adds Docker Desktop's command-line folder to PATH, because the
// Supabase CLI runs the tests inside a container.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const PATH = `${homedir()}/.docker/bin:${process.env.PATH}`;
const result = spawnSync('npx', ['supabase', 'test', 'db'], { stdio: 'inherit', env: { ...process.env, PATH } });
process.exit(result.status ?? 1);
