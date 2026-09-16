#!/usr/bin/env node
/**
 * Does the README still say what the commands say?
 *
 * Numbers in prose rot while the code stays right. This one has already had three: a check count in
 * AGENTS.md, a tool count and a check count in the judging document — each read as carelessness to
 * exactly the reviewer it was written for.
 *
 * So the figures are scraped out of the commands that produce them rather than trusted.
 *
 * Deliberately narrow: the handful a reader would act on, not every digit, because a check that
 * fires on a version string inside a code fence is a check somebody deletes.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const run = (args) => {
  const opts = { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 };
  try {
    return strip(execFileSync(process.execPath, args, opts));
  } catch (e) {
    if (typeof e.stdout === 'string' && e.stdout) return strip(e.stdout);
    throw e;
  }
};

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' }
  : { red: '', green: '', dim: '', off: '' };

const from = (text, re, label) => {
  const m = re.exec(text);
  if (!m) throw new Error(`could not find ${label} — this checker is out of date`);
  return m[1];
};

const questions = run([path.join(ROOT, 'eval', 'questions.js')]);
const { TOOLS } = (() => {
  // Count the tools the server actually registers, without starting it.
  const src = fs.readFileSync(path.join(ROOT, 'mcp', 'server.js'), 'utf8');
  return { TOOLS: (src.match(/^\s{4}name: '/gm) || []).length };
})();

const CLAIMS = [
  { what: 'MCP tools registered', value: String(TOOLS) },
  { what: 'questions asked, mean', value: from(questions, /([0-9.]+) questions on average/, 'mean') },
  { what: 'questions asked, worst case', value: from(questions, /worst case (\d+)/, 'worst case') },
  { what: 'mean effort', value: from(questions, /Mean effort ([0-9.]+)/, 'effort') },
  { what: 'separation threshold', value: `${Math.round(require('../mcp/tools/verify_diagnosis').SEPARATION * 100)}%` },
];

console.log('\n  README figures, against the commands that produce them\n');

let stale = 0;
for (const c of CLAIMS) {
  const present = README.includes(c.value);
  console.log(`  ${present ? C.green + 'ok  ' : C.red + 'MISSING'}${C.off} ${c.what.padEnd(32)} ${C.dim}${c.value}${C.off}`);
  if (!present) stale++;
}

console.log(stale
  ? `\n  ${C.red}${stale} figure(s) the commands produce do not appear in the README.${C.off}\n  Either the README is stale, or it stopped quoting something worth quoting.\n`
  : `\n  ${C.green}Every figure the README quotes is one a command still produces.${C.off}\n`);

if (stale) process.exitCode = 1;
