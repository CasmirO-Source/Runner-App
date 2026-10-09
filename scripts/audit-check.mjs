// Dependency vulnerability gate (PRD 9.4 rule 15, Appendix A #37).
//
// Runs `npm audit` and fails on any high or critical advisory, except those
// listed in audit-exceptions.json. An exception stops working on its review
// date, and an exception that no longer matches anything also fails the
// check, so the list can never quietly grow stale.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BLOCKING = new Set(['high', 'critical']);
const MAX_REVIEW_DAYS = 31;

// Options: --dir <folder> audits another folder (used for Edge Function
// dependencies); --allow-unused-exceptions skips the "no longer applies"
// check, since app-only exceptions do not apply there.
const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const auditDir = dirIndex >= 0 ? args[dirIndex + 1] : process.cwd();
const allowUnused = args.includes('--allow-unused-exceptions');

function runAudit() {
  try {
    return execFileSync('npm', ['audit', '--json'], { cwd: auditDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    // npm audit exits non-zero whenever it finds anything; the report is still on stdout.
    if (error.stdout) return error.stdout;
    throw error;
  }
}

const report = JSON.parse(runAudit());
if (report.error) {
  console.error(`audit-check: npm audit could not run (${report.error.code}). Failing safe.`);
  process.exit(1);
}

const found = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via === 'object' && BLOCKING.has(via.severity)) {
      const id = via.url.split('/').pop();
      found.set(id, { id, package: via.name, severity: via.severity, title: via.title });
    }
  }
}

const { exceptions } = JSON.parse(readFileSync(new URL('../audit-exceptions.json', import.meta.url), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const problems = [];

for (const ex of exceptions) {
  for (const field of ['id', 'package', 'severity', 'reason', 'approvedBy', 'approvedOn', 'reviewBy']) {
    if (!ex[field]) problems.push(`Exception ${ex.id ?? '(no id)'} is missing "${field}".`);
  }
  const days = (Date.parse(ex.reviewBy) - Date.parse(ex.approvedOn)) / 86_400_000;
  if (!(days >= 0 && days <= MAX_REVIEW_DAYS)) {
    problems.push(`Exception ${ex.id} review date must be within ${MAX_REVIEW_DAYS} days of approval.`);
  }
  if (ex.reviewBy < today) {
    problems.push(`Exception ${ex.id} (${ex.package}) passed its review date ${ex.reviewBy}. Check for a fix, then renew or remove it.`);
  }
  if (!found.has(ex.id) && !allowUnused) {
    problems.push(`Exception ${ex.id} (${ex.package}) no longer matches any advisory. Remove it from audit-exceptions.json.`);
  }
}

const exceptedIds = new Set(exceptions.map((ex) => ex.id));
for (const adv of found.values()) {
  if (!exceptedIds.has(adv.id)) {
    problems.push(`${adv.severity.toUpperCase()}: ${adv.package} ${adv.id} "${adv.title}"`);
  } else {
    console.log(`accepted until review date: ${adv.package} ${adv.id}`);
  }
}

if (problems.length > 0) {
  console.error('audit-check FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`audit-check passed: no unaccepted high or critical advisories (${found.size} accepted).`);
