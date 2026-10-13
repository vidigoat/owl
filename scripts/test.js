#!/usr/bin/env node
/**
 * Run every suite, even after one fails.
 *
 * The suites used to be chained with `&&`, which meant the first failure hid everything after it —
 * a one-character mistake in an early file reported "55 checks" and looked like five suites had
 * vanished. You want the whole picture when something breaks, not the first thing that broke.
 */

const { execFileSync } = require('node:child_process');
const nodeFs = require('node:fs');
const nodeOs = require('node:os');
const nodePath = require('node:path');

/*
 * Every suite gets a throwaway household and a throwaway spend ledger.
 *
 * `data/home.json` is a real household's memory — what it owns and what has been done to it — and
 * the suite was writing into it: the checks that POST junk to /api/remember to prove it cannot
 * crash the server did exactly that to the real file, and after one night it held two hundred
 * "repairs" and not one of them was real. A test that leaves the thing it tested dirty is a test
 * with a side effect nobody asked for. So the runner points every suite somewhere disposable,
 * unless the caller chose a location deliberately.
 */
const SCRATCH = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'hands-suite-'));
const SUITE_ENV = {
  ...process.env,
  HOME_STORE: process.env.HOME_STORE || nodePath.join(SCRATCH, 'home.json'),
  HANDS_LEDGER: process.env.HANDS_LEDGER || nodePath.join(SCRATCH, 'spend.json'),
};
process.on('exit', () => nodeFs.rmSync(SCRATCH, { recursive: true, force: true }));
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Every *.test.js in the project, minus node_modules. */
function findSuites(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findSuites(full, found);
    else if (entry.name.endsWith('.test.js')) found.push(full);
  }
  return found;
}

const suites = findSuites(ROOT).sort();
const results = [];
let totalChecks = 0;

for (const suite of suites) {
  const rel = path.relative(ROOT, suite);
  let output = '';
  let ok = true;

  try {
    // A suite gets three minutes. One that waits forever on something a fresh machine does not have
    // must fail by name, not hang the whole run until CI kills it with nothing printed.
    output = execFileSync('node', [suite], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: SUITE_ENV, timeout: 180000, killSignal: 'SIGKILL' });
  } catch (e) {
    ok = false;
    output = `${e.stdout || ''}${e.stderr || ''}${e.signal === 'SIGKILL' ? '\n  FAIL timed out after three minutes\n' : ''}`;
  }
  // In CI, say each suite as it finishes, so a slow one is visible while it is slow.
  if (process.env.CI) console.log(`  ${ok ? 'done' : 'FAILED'} ${rel}`);

  const checks = (output.match(/^ {2}ok {3}/gm) || []).length;
  const failures = (output.match(/^ {2}FAIL/gm) || []).length;
  totalChecks += checks;
  results.push({ rel, ok: ok && failures === 0, checks, failures, output });
}

console.log('');
results.forEach((r) => {
  const mark = r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${r.rel.padEnd(42)} ${String(r.checks).padStart(3)} checks${r.failures ? `  \x1b[31m${r.failures} failing\x1b[0m` : ''}`);
});

const broken = results.filter((r) => !r.ok);
if (broken.length) {
  console.log('\n  ── failures ──');
  broken.forEach((r) => {
    console.log(`\n  ${r.rel}`);
    r.output
      .split('\n')
      .filter((l) => /FAIL|Error|assert/.test(l))
      .slice(0, 6)
      .forEach((l) => console.log(`    ${l.trim()}`));
  });
}

console.log(
  `\n  ${totalChecks} checks across ${results.length} suites` +
    (broken.length ? `  —  \x1b[31m${broken.length} suite${broken.length === 1 ? '' : 's'} failing\x1b[0m\n` : '  —  all green\n')
);

/*
 * The README quotes this tally, and a count typed by hand goes stale — the sibling project's did
 * three times before its runner started checking. Only after an all-green run, so a stale README is
 * never reported on top of a real failure.
 */
if (!broken.length) {
  const want = `${results.length} suites · ${totalChecks} checks`;
  const readme = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'README.md'), 'utf8');
  if (!readme.includes(want)) {
    const quoted = /\d+ suites · \d+ checks/.exec(readme);
    console.log(`  README is stale: it says "${quoted ? quoted[0] : 'nothing'}" and this run was "${want}". Fix the line under the test command.\n`);
    process.exit(1);
  }
}

process.exit(broken.length ? 1 : 0);
