// Runs on `npm install`. Points Git at the committed .githooks folder so the
// gitleaks pre-commit scan is switched on for everyone who clones the repo.
// Skips quietly only when there is no Git repository (for example inside an
// EAS cloud build, which receives a copy of the files without .git).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.git')) {
  process.exit(0);
}
execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
console.log('Git hooks enabled: commits are scanned for secrets by gitleaks.');
