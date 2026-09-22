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
/*
 * Both documents, not just the README.
 *
 * This only ever read README.md, and docs/SUBMISSION.md is the one that gets SUBMITTED. Today it
 * was caught claiming "1.3 questions on average" and "mean effort 2.3 → 1.1" hours after both
 * figures had moved — corrected in the README, missed here, because nothing was looking. A stale
 * number in a README is embarrassing; the same number in the submission is the number a judge
 * checks against a command that disagrees with it.
 */
const DOCS = ['README.md', path.join('docs', 'SUBMISSION.md')];
const README = DOCS.map((f) => {
  try {
    return fs.readFileSync(path.join(ROOT, f), 'utf8');
  } catch {
    return ''; // a document that does not exist cannot be stale
  }
}).join('\n\n');
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

/*
 * `where` makes a claim contextual, and the tool count is why it exists.
 *
 * Every check here was "does the README contain this string anywhere". For a two-digit number that
 * is close to vacuous: "17" appears in this README inside a version, a price, a port number. The
 * check passed cheerfully for weeks while the text said **"all 14 tools"**, and the demo script's
 * outro said 14 as well. FRICTION-LOG records the same failure a third time, in AGENTS.md and
 * docs/JUDGING.md, with a check count.
 *
 * Three instances of one bug means the checker was the problem, not the prose. A claim with a
 * `where` pattern must now match IN CONTEXT: every place the README says "<n> tools" has to say the
 * right n, and a README that has stopped mentioning it at all fails too.
 */
/*
 * Counted from the same modules the product counts them from, so a figure in prose is checked
 * against the thing itself rather than against another piece of prose.
 */
/*
 * The review queue, which a fresh clone does not have.
 *
 * It is gitignored on purpose — the bench reviews the manuals YOU fetched, and a queue that shipped
 * pre-filled would be somebody else's homework already marked. That also means these two figures
 * cannot be reproduced anywhere but on a machine that has done the reading, and checking them
 * regardless made a fresh clone fail its own suite: `git clone && npm test` reported a failure, on
 * the exact command the README tells a judge to run, because a number was 433 here and 0 there.
 *
 * So they are checked where there is something to check them against, and skipped where there is
 * not — the same rule the sibling project applies to its fleet scan.
 */
const bench = require('../manual/review').queue();
const BENCH = {
  symptoms: bench.reduce((n, x) => n + x.symptoms, 0),
  causes: bench.reduce((n, x) => n + x.causes, 0),
};
const HAS_BENCH = bench.length > 0;
const lib = require('../data/service-data');
const LIBRARY = Object.keys(lib.MODELS).length + Object.keys(lib.ADMITTED).length;

/**
 * The built-in PDF reader, against poppler.
 *
 * This comparison needs both readers and a folder of manuals, and `manuals/` is gitignored — so it
 * cannot be re-run here, on a fresh clone, or in anybody else's checkout. `npm run pdf:compare`
 * records its result in `docs/pdf-compare.json`, and that recording is what the documents are
 * checked against: the figures cannot drift from a measurement that has been taken, and a reader
 * can see the date it was taken on.
 */
function readerClaims() {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'pdf-compare.json'), 'utf8'));
  } catch {
    return [];
  }
  return [
    { what: 'pdf reader: manuals compared', value: String(m.manuals), where: /of \*\*(\d+)\*\* manuals/g },
    { what: 'pdf reader: pages compared', value: m.pages.toLocaleString(), where: /all \*\*([\d,]+)\*\* pages/g },
    // Written as a range — "99.3–100% of poppler's words" — so the per cent sign belongs to the
    // upper bound, not to the figure being checked.
    { what: 'pdf reader: worst word recall', value: String(m.worstWordRecall), where: /([\d.]+)–100%\*{0,2} of poppler/g },
    { what: 'pdf reader: rows recovered', value: `${m.rowsRecoveredExactly}%`, where: /\*\*([\d.]+%)\*\* recovered word for word/g },
    { what: 'pdf reader: rows poppler missed', value: String(m.rowsPopplerDidNotProduce), where: /plus (\d+) rows poppler did not produce/g },
  ];
}

const CLAIMS = [
  { what: 'MCP tools registered', value: String(TOOLS), where: /(\d+) (?:MCP )?tools\b/g },
  ...readerClaims(),
  { what: 'questions asked, mean', value: from(questions, /([0-9.]+) questions on average/, 'mean') },
  { what: 'questions asked, worst case', value: from(questions, /worst case (\d+)/, 'worst case') },
  { what: 'mean effort', value: from(questions, /Mean effort ([0-9.]+)/, 'effort') },
  { what: 'separation threshold', value: `${Math.round(require('../mcp/tools/verify_diagnosis').SEPARATION * 100)}%` },

  /*
   * What the bench is actually holding.
   *
   * These move whenever the parser improves, and they moved twice in one evening: 144 causes became
   * 126 when explanatory sentences stopped being read as causes, and both documents went on quoting
   * the old figure. A number that changes every time the code gets better is exactly the number a
   * checker should own.
   */
  ...(HAS_BENCH
    ? [
      { what: 'symptoms on the bench', value: String(BENCH.symptoms), where: /(\d+) symptoms, \d+ causes/g },
      { what: 'causes on the bench', value: String(BENCH.causes), where: /\d+ symptoms, (\d+) causes/g },
    ]
    : []),
  { what: 'machines in the library', value: String(LIBRARY), where: /(\d+) machines? (?:are |is )?in the library/gi },
];

console.log('\n  README figures, against the commands that produce them\n');

let stale = 0;
for (const c of CLAIMS) {
  let present;
  let detail = '';

  if (c.where) {
    // Every occurrence, not the first: one corrected sentence next to three stale ones reads as
    // fixed and is not.
    const found = [...README.matchAll(c.where)].map((m) => m[1]);
    const wrong = found.filter((v) => v !== c.value);
    present = found.length > 0 && wrong.length === 0;
    detail = found.length === 0 ? ' — the README no longer mentions it' : wrong.length ? ` — README says ${[...new Set(wrong)].join(', ')}` : '';
  } else {
    present = README.includes(c.value);
  }

  console.log(`  ${present ? C.green + 'ok  ' : C.red + 'STALE  '}${C.off} ${c.what.padEnd(32)} ${C.dim}${c.value}${detail}${C.off}`);
  if (!present) stale++;
}

console.log(stale
  ? `\n  ${C.red}${stale} figure(s) the commands produce do not appear in README.md or docs/SUBMISSION.md.${C.off}\n  Either the README is stale, or it stopped quoting something worth quoting.\n`
  : `\n  ${C.green}Every figure these documents quote is one a command still produces.${C.off}\n`);

if (stale) process.exitCode = 1;
