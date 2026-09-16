#!/usr/bin/env node
/**
 * Run every suite, even after one fails.
 *
 * The suites used to be chained with `&&`, which meant the first failure hid everything after it —
 * a one-character mistake in an early file reported "55 checks" and looked like five suites had
 * vanished. You want the whole picture when something breaks, not the first thing that broke.
 */

const { execFileSync } = require('node:child_process');
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
    output = execFileSync('node', [suite], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    ok = false;
    output = `${e.stdout || ''}${e.stderr || ''}`;
  }

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

process.exit(broken.length ? 1 : 0);
